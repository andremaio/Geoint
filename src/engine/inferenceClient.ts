import type { ModelDtype, ModelLoadProgress } from '../types/geoint';
import type { SpatialCluster } from './candidates';
import type { WorkerRequest, WorkerResponse } from './geoclip.worker';

export interface VisualInferenceOutput {
  clusters: SpatialCluster[];
  spatialSpreadKm: number;
  distinctContinentsCount: number;
  executionProvider: 'webgpu' | 'wasm';
  gallerySize: number;
  inferenceDurationMs: number;
  locationCacheHit: boolean;
}

let workerInstance: Worker | null = null;
let activeReject: ((err: Error) => void) | null = null;
let activeTaskId: string | null = null;

function getOrCreateWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./geoclip.worker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return workerInstance;
}

export function cancelVisualGeolocation(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  activeTaskId = null;
  if (activeReject) {
    const rej = activeReject;
    activeReject = null;
    rej(new Error('ABORTED'));
  }
}

export async function checkVisualModelCached(dtype: ModelDtype): Promise<boolean> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const suffix =
        dtype === 'int8'
          ? 'vision_model_int8.onnx'
          : dtype === 'bnb4'
            ? 'vision_model_bnb4.onnx'
            : 'vision_model_q4.onnx';
      const hasVision = keys.some((r) => r.url.includes(suffix));
      const hasLocation = keys.some((r) => r.url.includes('location_model'));
      return hasVision && hasLocation;
    }
  } catch {
    // fallback false
  }
  return false;
}

export function runVisualGeolocation(params: {
  imageBuffer: ArrayBuffer;
  mimeType: string;
  dtype: ModelDtype;
  onProgress?: (progress: ModelLoadProgress) => void;
}): Promise<VisualInferenceOutput> {
  if (activeTaskId) {
    cancelVisualGeolocation();
  }

  return new Promise<VisualInferenceOutput>((resolve, reject) => {
    const worker = getOrCreateWorker();
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeTaskId = taskId;
    activeReject = reject;

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      if (activeTaskId === taskId) {
        activeTaskId = null;
        activeReject = null;
      }
    };

    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (!msg || msg.id !== taskId) return;

      if (msg.type === 'progress') {
        params.onProgress?.(msg.progress);
      } else if (msg.type === 'result') {
        cleanup();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.error || 'Visual geolocation worker error'));
      }
    };

    const onError = (err: ErrorEvent) => {
      cleanup();
      reject(new Error(err.message || 'Web Worker crashed during visual inference'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    // Clone buffer before transfer so original file bytes in UI remain intact
    const transferCopy = params.imageBuffer.slice(0);
    const req: WorkerRequest = {
      id: taskId,
      type: 'analyze',
      dtype: params.dtype,
      imageBuffer: transferCopy,
      mimeType: params.mimeType,
    };

    worker.postMessage(req, [transferCopy]);
  });
}
