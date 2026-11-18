import type { StyleSpecification } from 'maplibre-gl';
import coastlinesRaw from '../assets/coastlines-110m.json';

export type MapTheme = 'obsidian' | 'liberty' | 'positron';

export const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export const TERRARIUM_ATTRIBUTION =
  'Terrain: Mapzen/Tilezen via AWS Open Data (USGS 3DEP, SRTM, GMTED2010, ArcticDEM, EU-DEM, ETOPO1)';

export const TERRARIUM_TILES = [
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
];

export function buildOfflineFallbackStyle(): StyleSpecification {
  const features = (coastlinesRaw as Array<Array<[number, number]>>).map((coords) => ({
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: coords,
    },
  }));

  return {
    version: 8,
    name: 'CRIMNEX Offline Vector Fallback',
    sources: {
      coastlines: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': '#06080c',
        },
      },
      {
        id: 'offline-coastlines',
        type: 'line',
        source: 'coastlines',
        paint: {
          'line-color': '#38bdf8',
          'line-opacity': 0.35,
          'line-width': 1.1,
        },
      },
    ],
  };
}

export async function loadCartographicStyle(
  theme: MapTheme
): Promise<{ style: StyleSpecification; offlineFallback: boolean }> {
  const styleUrl =
    theme === 'liberty'
      ? 'https://tiles.openfreemap.org/styles/liberty'
      : theme === 'positron'
        ? 'https://tiles.openfreemap.org/styles/positron'
        : 'https://tiles.openfreemap.org/styles/dark';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(styleUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Style HTTP ${res.status}`);

    const style = (await res.json()) as StyleSpecification;

    // Tune OpenFreeMap dark style into CRIMNEX Obsidian palette
    if (theme === 'obsidian' && Array.isArray(style.layers)) {
      for (const layer of style.layers) {
        if (layer.id === 'background' && layer.type === 'background') {
          layer.paint = { ...layer.paint, 'background-color': '#070a10' };
        } else if (layer.id === 'water' && layer.type === 'fill') {
          layer.paint = { ...layer.paint, 'fill-color': '#04070d' };
        } else if (layer.id === 'building' && layer.type === 'fill') {
          layer.paint = {
            ...layer.paint,
            'fill-color': '#111827',
            'fill-outline-color': '#1e293b',
            'fill-opacity': 0.88,
          };
        } else if (layer.id === 'landuse_park' && layer.type === 'fill') {
          layer.paint = { ...layer.paint, 'fill-color': '#0a1414' };
        }
      }
    }

    return { style, offlineFallback: false };
  } catch {
    return { style: buildOfflineFallbackStyle(), offlineFallback: true };
  }
}
