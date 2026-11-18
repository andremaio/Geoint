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
let loadPromise: Promise<GazetteerDataset | null> | null = null;

export async function loadGazetteer(): Promise<GazetteerDataset | null> {
  if (cachedDataset) return cachedDataset;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const res = await fetch('/data/gazetteer.json');
      if (!res.ok) return null;
      cachedDataset = (await res.json()) as GazetteerDataset;
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

function normalizeToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export async function matchTokensToGazetteer(tokens: string[], limit = 12): Promise<
  Array<{
    token: string;
    name: string;
    countryCode: string;
    countryName: string;
    lat: number;
    lon: number;
  }>
> {
  const dataset = await loadGazetteer();
  if (!dataset || tokens.length === 0) return [];

  const cleanTokens = Array.from(
    new Set(
      tokens
        .map(normalizeToken)
        .filter((t) => t.length >= 4 && !/^\d+$/.test(t))
    )
  ).slice(0, 40);

  if (cleanTokens.length === 0) return [];

  const matches: Array<{
    token: string;
    name: string;
    countryCode: string;
    countryName: string;
    lat: number;
    lon: number;
  }> = [];
  const seenKey = new Set<string>();

  for (const p of dataset.places) {
    const pName = normalizeToken(p[0]);
    const pAscii = p[1] ? normalizeToken(p[1]) : pName;
    for (const tok of cleanTokens) {
      if (pName === tok || pAscii === tok) {
        const key = `${p[0]}|${p[2]}`;
        if (!seenKey.has(key)) {
          seenKey.add(key);
          matches.push({
            token: tok,
            name: p[0],
            countryCode: p[2],
            countryName: dataset.countries[p[2]] || p[2],
            lat: p[4],
            lon: p[5],
          });
          if (matches.length >= limit) return matches;
        }
      }
    }
  }
  return matches;
}
