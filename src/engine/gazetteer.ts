import type { GazetteerPlace } from '../types/geoint';
import { bearingToCompass, haversineKm, initialBearingDeg } from './geoMath';

type RawPlaceTuple = [
  name: string,
  asciiName: string,
  countryCode: string,
  region: string,
  lat: number,
  lon: number,
  population: number,
];

interface GazetteerDataset {
  countries: Record<string, string>;
  places: RawPlaceTuple[];
}

let cachedDataset: GazetteerDataset | null = null;
let tokenIndex: Map<string, RawPlaceTuple[]> | null = null;
let loadPromise: Promise<GazetteerDataset | null> | null = null;

function normalizeToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// OCR on advertisements or decorations often matches unrelated town names.
// Only distinctive text is eligible to create an automatic geographic lead.
// Rejected words remain visible in the raw OCR transcription for human review.
const COMMON_SCENE_WORDS = new Set([
  'sale', 'market', 'hotel', 'hostel', 'church', 'museum', 'centre', 'center',
  'station', 'street', 'avenue', 'plaza', 'square', 'store', 'school',
  'restaurant', 'parking', 'christmas', 'festival', 'welcome', 'entrada',
  'saida', 'salida', 'sortie', 'open', 'closed', 'aberto', 'ferme',
]);

export function isDistinctiveOcrToponym(token: string): boolean {
  const cleaned = normalizeToken(token).replace(/\s+/g, ' ');
  if (!cleaned || COMMON_SCENE_WORDS.has(cleaned)) return false;
  if (!/^[a-z\p{L}][a-z\p{L} '\-]*$/u.test(cleaned)) return false;
  const terms = cleaned.split(/[ '\-]+/).filter(Boolean);
  if (terms.length === 1) return cleaned.length >= 6;
  return cleaned.length >= 8 && terms.some((term) => term.length >= 4);
}

function buildTokenIndex(dataset: GazetteerDataset): Map<string, RawPlaceTuple[]> {
  const index = new Map<string, RawPlaceTuple[]>();
  for (const p of dataset.places) {
    const keys = new Set<string>();
    const pName = normalizeToken(p[0]);
    if (pName) keys.add(pName);
    if (p[1]) {
      const pAscii = normalizeToken(p[1]);
      if (pAscii) keys.add(pAscii);
    }
    for (const k of keys) {
      let bucket = index.get(k);
      if (!bucket) {
        bucket = [];
        index.set(k, bucket);
      }
      bucket.push(p);
    }
  }
  for (const bucket of index.values()) {
    if (bucket.length > 1) {
      bucket.sort((a, b) => b[6] - a[6]);
    }
  }
  return index;
}

export async function loadGazetteer(): Promise<GazetteerDataset | null> {
  if (cachedDataset) return cachedDataset;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch('/data/gazetteer.json');
      if (!res.ok) return null;
      const parsed = (await res.json()) as GazetteerDataset;
      cachedDataset = parsed;
      tokenIndex = buildTokenIndex(parsed);
      return cachedDataset;
    } catch {
      return null;
    }
  })();
  return loadPromise;
}

export async function findNearestPlace(lat: number, lon: number): Promise<GazetteerPlace | null> {
  const dataset = await loadGazetteer();
  if (!dataset || !dataset.places.length) return null;

  let bestIdx = -1;
  let bestDist = Infinity;

  // Quick degree-box prefilter before exact haversine
  for (let i = 0; i < dataset.places.length; i++) {
    const p = dataset.places[i];
    const dLat = Math.abs(p[4] - lat);
    if (dLat > 8) continue;
    const dLon = Math.abs(p[5] - lon);
    if (dLon > 16 && dLon < 344) continue;
    const d = haversineKm(p[4], p[5], lat, lon);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // Fallback global scan for remote oceans / islands > 8 deg from a city
  if (bestIdx === -1) {
    for (let i = 0; i < dataset.places.length; i++) {
      const p = dataset.places[i];
      const d = haversineKm(p[4], p[5], lat, lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }

  if (bestIdx === -1) return null;
  const chosen = dataset.places[bestIdx];
  const bearing = initialBearingDeg(chosen[4], chosen[5], lat, lon);

  return {
    name: chosen[0],
    countryCode: chosen[2],
    countryName: dataset.countries[chosen[2]] || chosen[2],
    region: chosen[3],
    lat: chosen[4],
    lon: chosen[5],
    population: chosen[6],
    distanceKm: Number(bestDist.toFixed(1)),
    bearingDeg: Number(bearing.toFixed(0)),
    compass: bearingToCompass(bearing),
  };
}

export async function matchTokensToGazetteer(
  tokens: string[],
  limit = 12
): Promise<
  Array<{
    token: string;
    name: string;
    countryCode: string;
    countryName: string;
    region?: string;
    population?: number;
    lat: number;
    lon: number;
  }>
> {
  const dataset = await loadGazetteer();
  if (!dataset || !tokenIndex || tokens.length === 0) return [];

  const cleanTokens = Array.from(
    new Set(
      tokens
        .map(normalizeToken)
        .filter(isDistinctiveOcrToponym)
    )
  ).slice(0, 600);

  if (cleanTokens.length === 0) return [];

  const matches: Array<{
    token: string;
    name: string;
    countryCode: string;
    countryName: string;
    region?: string;
    population?: number;
    lat: number;
    lon: number;
  }> = [];
  const seenKey = new Set<string>();

  for (const tok of cleanTokens) {
    const candidates = tokenIndex.get(tok);
    if (!candidates) continue;
    for (const p of candidates) {
      const key = `${p[0]}|${p[2]}`;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        matches.push({
          token: tok,
          name: p[0],
          countryCode: p[2],
          countryName: dataset.countries[p[2]] || p[2],
          region: p[3],
          population: p[6],
          lat: p[4],
          lon: p[5],
        });
        if (matches.length >= limit) return matches;
      }
    }
  }
  return matches;
}
