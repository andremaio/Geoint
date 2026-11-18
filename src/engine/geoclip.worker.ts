/// <reference lib="webworker" />
import { AutoModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';
import type { ModelDtype, ModelLoadProgress } from '../types/geoint';
import { clusterSpatialHypotheses, type ScoredCoordinate } from './candidates';
import { haversineKm } from './geoMath';

const MODEL_ID = 'Xenova/geoclip-large-patch14';
// Trained GeoCLIP logit_scale scalar = exp(3.681034803390503) ~= 39.687
const LOGIT_SCALE = Math.exp(3.681034803390503);

const LOC_IDB_NAME = 'crimnex_geoclip_index_v1';
const LOC_IDB_STORE = 'gallery_index';
const LOC_IDB_KEY = 'geoclip_100k_q8_v1';

// Ensure WASM stays fetched from public jsDelivr CDN (keeping Cloudflare Pages dist/ < 25 MiB per file)
if (env.backends?.onnx?.wasm) {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
}

interface StoredLocationIndex {
  key: string;
  numCoords: number;
  embedDim: number;
  coords: ArrayBuffer;
  q: ArrayBuffer;
  scales: ArrayBuffer;
}

export type WorkerRequest =
  | {
      id: string;
      type: 'analyze';
      dtype: ModelDtype;
      imageBuffer: ArrayBuffer;
      mimeType: string;
    }
  | {
      id: string;
      type: 'warm_check';
      dtype: ModelDtype;
    };

export type WorkerResponse =
  | {
      id: string;
      type: 'progress';
      progress: ModelLoadProgress;
    }
  | {
      id: string;
      type: 'result';
      result: {
        clusters: ReturnType<typeof clusterSpatialHypotheses>['clusters'];
        spatialSpreadKm: number;
        distinctContinentsCount: number;
        executionProvider: 'webgpu' | 'wasm';
        gallerySize: number;
        inferenceDurationMs: number;
        locationCacheHit: boolean;
      };
    }
  | {
      id: string;
      type: 'warm_status';
      cached: boolean;
    }
  | {
      id: string;
      type: 'error';
      error: string;
    };

type LoadedVisionModel = Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
type LoadedLocationModel = Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
type LoadedProcessor = Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;

let visionModel: LoadedVisionModel | null = null;
let locationModel: LoadedLocationModel | null = null;
let processor: LoadedProcessor | null = null;
let loadedDtype: ModelDtype | null = null;
let activeProvider: 'webgpu' | 'wasm' = 'wasm';

let galleryCoords: Float32Array | null = null;
let galleryQ8: Int8Array | null = null;
let galleryScales: Float32Array | null = null;
let galleryEmbedDim = 512;
let galleryCount = 0;

function postProgress(id: string, progress: ModelLoadProgress): void {
  const msg: WorkerResponse = { id, type: 'progress', progress };
  self.postMessage(msg);
}

function l2NormalizeRows(data: Float32Array, rows: number, dim: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    let sum = 0;
    for (let c = 0; c < dim; c++) {
      const v = data[off + c];
      sum += v * v;
    }
    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let c = 0; c < dim; c++) {
      out[off + c] = data[off + c] * inv;
    }
  }
  return out;
}

function quantizeMatrixInt8(
  normData: Float32Array,
  rows: number,
  dim: number
): { q: Int8Array; scales: Float32Array } {
  const q = new Int8Array(rows * dim);
  const scales = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    let maxAbs = 0;
    for (let c = 0; c < dim; c++) {
      const a = Math.abs(normData[off + c]);
      if (a > maxAbs) maxAbs = a;
    }
    const scale = maxAbs > 0 ? maxAbs / 127 : 1;
    scales[r] = scale;
    const inv = 1 / scale;
    for (let c = 0; c < dim; c++) {
      q[off + c] = Math.round(normData[off + c] * inv);
    }
  }
  return { q, scales };
}

function openLocationIndexDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(LOC_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOC_IDB_STORE)) {
        db.createObjectStore(LOC_IDB_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readCachedLocationIndex(): Promise<StoredLocationIndex | null> {
  try {
    const db = await openLocationIndexDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(LOC_IDB_STORE, 'readonly');
      const req = tx.objectStore(LOC_IDB_STORE).get(LOC_IDB_KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as StoredLocationIndex) || null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

async function writeCachedLocationIndex(record: StoredLocationIndex): Promise<void> {
  try {
    const db = await openLocationIndexDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(LOC_IDB_STORE, 'readwrite');
      tx.objectStore(LOC_IDB_STORE).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Non-fatal if storage quota exceeded
  }
}

async function checkModelCachePresent(dtype: ModelDtype): Promise<boolean> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const expectedVisionSuffix =
        dtype === 'int8'
          ? 'vision_model_int8.onnx'
          : dtype === 'bnb4'
            ? 'vision_model_bnb4.onnx'
            : 'vision_model_q4.onnx';
      const hasVision = keys.some((r) => r.url.includes(expectedVisionSuffix));
      const hasLocation = keys.some((r) => r.url.includes('location_model'));
      return hasVision && hasLocation;
    }
  } catch {
    // ignore cache inspection failure
  }
  return false;
}

async function detectUsableWebGpu(): Promise<boolean> {
  try {
    const nav = self.navigator as unknown as {
      gpu?: { requestAdapter?: () => Promise<unknown | null> };
    };
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== 'function') return false;
    const adapter = await nav.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

async function ensureModelsLoaded(id: string, dtype: ModelDtype): Promise<void> {
  if (visionModel && locationModel && processor && loadedDtype === dtype) {
    return;
  }

  const fileTotals = new Map<string, { loaded: number; total: number }>();
  let lastEmit = 0;

  const emitDownloadProgress = (activeFile?: string) => {
    const now = performance.now();
    if (now - lastEmit < 120) return;
    lastEmit = now;

    let loadedBytes = 0;
    let totalBytes = 0;
    for (const item of fileTotals.values()) {
      loadedBytes += item.loaded;
      totalBytes += item.total;
    }
    const percent = totalBytes > 0 ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : 5;
    postProgress(id, {
      stage: 'downloading_model',
      percent,
      downloadedBytes: loadedBytes,
      totalBytes,
      activeFile,
    });
  };

  const progressCallback = (info: {
    status: string;
    file?: string;
    loaded?: number;
    total?: number;
  }) => {
    if (info.file && typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0) {
      fileTotals.set(info.file, { loaded: info.loaded, total: info.total });
      emitDownloadProgress(info.file);
    } else if (info.status === 'initiate' && info.file && !fileTotals.has(info.file)) {
      fileTotals.set(info.file, { loaded: 0, total: 0 });
    }
  };

  postProgress(id, {
    stage: 'downloading_model',
    percent: 2,
    detail: 'Checking cache & runtime backend...',
  });

  const hasWebGpu = await detectUsableWebGpu();
  const preferredDevice: 'webgpu' | 'wasm' = hasWebGpu ? 'webgpu' : 'wasm';

  const loadWithDevice = async (device: 'webgpu' | 'wasm') => {
    const [vm, lm, proc] = await Promise.all([
      AutoModel.from_pretrained(MODEL_ID, {
        model_file_name: 'vision_model',
        dtype,
        device,
        progress_callback: progressCallback,
      }),
      AutoModel.from_pretrained(MODEL_ID, {
        model_file_name: 'location_model',
        dtype: 'fp32',
        device: 'wasm', // LocationEncoder MLPs batch fastest deterministically on WASM
        progress_callback: progressCallback,
      }),
      AutoProcessor.from_pretrained(MODEL_ID, {
        progress_callback: progressCallback,
      }),
    ]);
    return { vm, lm, proc };
  };

  try {
    const loaded = await loadWithDevice(preferredDevice);
    visionModel = loaded.vm;
    locationModel = loaded.lm;
    processor = loaded.proc;
    loadedDtype = dtype;
    activeProvider = preferredDevice;
  } catch (err) {
    if (preferredDevice === 'webgpu') {
      // Fallback cleanly to WASM if WebGPU session creation failed
      const loaded = await loadWithDevice('wasm');
      visionModel = loaded.vm;
      locationModel = loaded.lm;
      processor = loaded.proc;
      loadedDtype = dtype;
      activeProvider = 'wasm';
    } else {
      throw err;
    }
  }
}

async function ensureLocationGalleryReady(id: string): Promise<boolean> {
  if (galleryCoords && galleryQ8 && galleryScales && galleryCount > 0) {
    return true;
  }

  postProgress(id, {
    stage: 'building_location_index',
    percent: 3,
    detail: 'Checking cached 100k spatial index...',
  });

  const cached = await readCachedLocationIndex();
  if (cached && cached.numCoords > 0 && cached.embedDim > 0) {
    galleryCoords = new Float32Array(cached.coords);
    galleryQ8 = new Int8Array(cached.q);
    galleryScales = new Float32Array(cached.scales);
    galleryCount = cached.numCoords;
    galleryEmbedDim = cached.embedDim;
    return true;
  }

  // Fetch official MIT-licensed 100k coordinates binary
  const res = await fetch(`https://huggingface.co/${MODEL_ID}/resolve/main/gps_gallery/coordinates_100K.bin`);
  if (!res.ok) {
    throw new Error(`Failed to fetch coordinate gallery (HTTP ${res.status})`);
  }
  const coordsBuf = await res.arrayBuffer();
  const coords = new Float32Array(coordsBuf);
  const numCoords = Math.floor(coords.length / 2);

  if (!locationModel) {
    throw new Error('Location encoder is not initialized.');
  }

  const batchSize = 4096;
  let embedDim = 512;
  let normMatrix: Float32Array | null = null;

  for (let i = 0; i < numCoords; i += batchSize) {
    const count = Math.min(batchSize, numCoords - i);
    const slice = coords.subarray(i * 2, (i + count) * 2);
    const out = await locationModel({
      location: new Tensor('float32', slice, [count, 2]),
    });
    const embeds = out.location_embeds.data as Float32Array;
    if (!normMatrix) {
      embedDim = Math.round(embeds.length / count);
      normMatrix = new Float32Array(numCoords * embedDim);
    }
    const normChunk = l2NormalizeRows(embeds, count, embedDim);
    normMatrix.set(normChunk, i * embedDim);

    const pct = Math.min(98, Math.round(((i + count) / numCoords) * 95));
    postProgress(id, {
      stage: 'building_location_index',
      percent: pct,
      detail: `${(i + count).toLocaleString()} / ${numCoords.toLocaleString()} coordinates`,
    });
  }

  const { q, scales } = quantizeMatrixInt8(normMatrix!, numCoords, embedDim);
  galleryCoords = coords;
  galleryQ8 = q;
  galleryScales = scales;
  galleryCount = numCoords;
  galleryEmbedDim = embedDim;

  // Save compact ~51.6 MB matrix in IndexedDB for instant subsequent analyses
  await writeCachedLocationIndex({
    key: LOC_IDB_KEY,
    numCoords,
    embedDim,
    coords: coords.buffer.slice(0) as ArrayBuffer,
    q: q.buffer.slice(0) as ArrayBuffer,
    scales: scales.buffer.slice(0) as ArrayBuffer,
  });

  return false;
}

function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

async function refineClusterCentroids(
  imgNorm: Float32Array,
  embedDim: number,
  initialClusters: ReturnType<typeof clusterSpatialHypotheses>['clusters']
): Promise<ReturnType<typeof clusterSpatialHypotheses>['clusters']> {
  if (!locationModel || initialClusters.length === 0) return initialClusters;

  const refined = initialClusters.map((c) => ({ ...c }));

  // Two coarse-to-fine continuous refinement passes (±0.08° then ±0.015°)
  const radii = [0.08, 0.015];
  const gridRadius = 3; // 7x7 = 49 points per cluster

  for (const halfSpan of radii) {
    const gridCoords: number[] = [];
    const ownerCluster: number[] = [];

    for (let ci = 0; ci < refined.length; ci++) {
      const c = refined[ci];
      const step = halfSpan / gridRadius;
      for (let dy = -gridRadius; dy <= gridRadius; dy++) {
        for (let dx = -gridRadius; dx <= gridRadius; dx++) {
          gridCoords.push(clampLat(c.peakLat + dy * step), wrapLon(c.peakLon + dx * step));
          ownerCluster.push(ci);
        }
      }
    }

    const totalPts = ownerCluster.length;
    if (totalPts === 0) break;

    const out = await locationModel({
      location: new Tensor('float32', new Float32Array(gridCoords), [totalPts, 2]),
    });
    const embeds = l2NormalizeRows(out.location_embeds.data as Float32Array, totalPts, embedDim);

    for (let pi = 0; pi < totalPts; pi++) {
      const ci = ownerCluster[pi];
      const off = pi * embedDim;
      let dot = 0;
      for (let d = 0; d < embedDim; d++) {
        dot += imgNorm[d] * embeds[off + d];
      }
      const logit = LOGIT_SCALE * dot;
      if (logit > refined[ci].peakLogit) {
        const candLat = gridCoords[pi * 2];
        const candLon = gridCoords[pi * 2 + 1];
        // Keep refinement within cluster radius neighborhood (25 km)
        if (haversineKm(refined[ci].peakLat, refined[ci].peakLon, candLat, candLon) <= 25) {
          refined[ci].peakLogit = Number(logit.toFixed(3));
          refined[ci].peakLat = Number(candLat.toFixed(5));
          refined[ci].peakLon = Number(candLon.toFixed(5));
          refined[ci].lat = Number(candLat.toFixed(5));
          refined[ci].lon = Number(candLon.toFixed(5));
        }
      }
    }
  }

  return refined;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'warm_check') {
    const [modelCached, indexCached] = await Promise.all([
      checkModelCachePresent(msg.dtype),
      readCachedLocationIndex().then((r) => Boolean(r && r.numCoords > 0)),
    ]);
    const resp: WorkerResponse = {
      id: msg.id,
      type: 'warm_status',
      cached: modelCached && indexCached,
    };
    self.postMessage(resp);
    return;
  }

  if (msg.type === 'analyze') {
    const startMs = performance.now();
    try {
      await ensureModelsLoaded(msg.id, msg.dtype);
      const locationCacheHit = await ensureLocationGalleryReady(msg.id);

      postProgress(msg.id, {
        stage: 'running_vision',
        percent: 55,
        detail: 'Encoding photographic visual features...',
      });

      const blob = new Blob([msg.imageBuffer], { type: msg.mimeType || 'image/jpeg' });
      const rawImg = await RawImage.fromBlob(blob);
      const visionInputs = await processor!(rawImg);
      const { image_embeds } = await visionModel!(visionInputs);
      const imgNorm = l2NormalizeRows(
        image_embeds.data as Float32Array,
        1,
        galleryEmbedDim
      );

      postProgress(msg.id, {
        stage: 'clustering',
        percent: 80,
        detail: 'Scoring 100k coordinates & refining spatial clusters...',
      });

      const N = galleryCount;
      const D = galleryEmbedDim;
      const q8 = galleryQ8!;
      const scales = galleryScales!;
      const coords = galleryCoords!;

      // Step 1: Ultra-fast Int8 scan across all 100k coordinates (~100 ms)
      const q8Logits = new Float32Array(N);
      for (let r = 0; r < N; r++) {
        const off = r * D;
        let dot = 0;
        for (let c = 0; c < D; c++) {
          dot += imgNorm[c] * q8[off + c];
        }
        q8Logits[r] = LOGIT_SCALE * dot * scales[r];
      }

      // Step 2: Re-evaluate top 2,048 candidates in exact Float32 via location_model
      const topKExact = Math.min(2048, N);
      const topIndices = Array.from({ length: N }, (_, idx) => idx)
        .sort((a, b) => q8Logits[b] - q8Logits[a])
        .slice(0, topKExact);

      const exactCoordsSlice = new Float32Array(topKExact * 2);
      for (let i = 0; i < topKExact; i++) {
        const idx = topIndices[i];
        exactCoordsSlice[i * 2] = coords[idx * 2];
        exactCoordsSlice[i * 2 + 1] = coords[idx * 2 + 1];
      }

      const exactLocOut = await locationModel!({
        location: new Tensor('float32', exactCoordsSlice, [topKExact, 2]),
      });
      const exactNorm = l2NormalizeRows(
        exactLocOut.location_embeds.data as Float32Array,
        topKExact,
        D
      );

      const mergedLogits = new Float32Array(q8Logits);
      const exactTopScores: Array<{ idx: number; lat: number; lon: number; logit: number }> = [];
      let maxLogit = -Infinity;

      for (let i = 0; i < topKExact; i++) {
        const idx = topIndices[i];
        const off = i * D;
        let dot = 0;
        for (let c = 0; c < D; c++) {
          dot += imgNorm[c] * exactNorm[off + c];
        }
        const logit = LOGIT_SCALE * dot;
        mergedLogits[idx] = logit;
        if (logit > maxLogit) maxLogit = logit;
        exactTopScores.push({
          idx,
          lat: coords[idx * 2],
          lon: coords[idx * 2 + 1],
          logit,
        });
      }

      for (let r = 0; r < N; r++) {
        if (mergedLogits[r] > maxLogit) maxLogit = mergedLogits[r];
      }

      // Full-gallery softmax denominator preserves empirical background signal rejection
      let sumExp = 0;
      for (let r = 0; r < N; r++) {
        sumExp += Math.exp(mergedLogits[r] - maxLogit);
      }

      exactTopScores.sort((a, b) => b.logit - a.logit);
      const scoredTop: ScoredCoordinate[] = exactTopScores.slice(0, 400).map((item) => ({
        lat: item.lat,
        lon: item.lon,
        logit: item.logit,
        prob: Math.exp(item.logit - maxLogit) / sumExp,
      }));

      const clustered = clusterSpatialHypotheses(scoredTop, 50, 5);
      const refinedClusters = await refineClusterCentroids(imgNorm, D, clustered.clusters);

      postProgress(msg.id, {
        stage: 'ready',
        percent: 100,
      });

      const resp: WorkerResponse = {
        id: msg.id,
        type: 'result',
        result: {
          clusters: refinedClusters,
          spatialSpreadKm: clustered.spatialSpreadKm,
          distinctContinentsCount: clustered.distinctContinentsCount,
          executionProvider: activeProvider,
          gallerySize: N,
          inferenceDurationMs: Math.round(performance.now() - startMs),
          locationCacheHit,
        },
      };
      self.postMessage(resp);
    } catch (err) {
      const resp: WorkerResponse = {
        id: msg.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(resp);
    }
  }
};
