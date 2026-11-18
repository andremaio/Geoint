import type { WikimediaReferencePhoto } from '../types/geoint';
import { haversineKm } from './geoMath';

const COMMERCIAL_SAFE_LICENSES = [
  'CC0',
  'Public domain',
  'CC BY 4.0',
  'CC BY 3.0',
  'CC BY 2.0',
  'CC BY-SA 4.0',
  'CC BY-SA 3.0',
  'CC BY-SA 2.0',
];

function stripHtml(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Privacy-preserving georeferenced visual reference search.
 * Only queries candidate coordinates when explicitly triggered by the investigator.
 * Never transmits the investigated image or its hashes.
 */
export async function searchNearbyOpenReferencePhotos(
  lat: number,
  lon: number,
  radiusMeters = 1200,
  limit = 6
): Promise<WikimediaReferencePhoto[]> {
  const clampedRadius = Math.max(100, Math.min(10000, Math.round(radiusMeters)));
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'geosearch');
  url.searchParams.set('ggscoord', `${lat.toFixed(5)}|${lon.toFixed(5)}`);
  url.searchParams.set('ggsradius', String(clampedRadius));
  url.searchParams.set('ggsnamespace', '6');
  url.searchParams.set('ggslimit', '20');
  url.searchParams.set('prop', 'coordinates|imageinfo');
  url.searchParams.set('iiprop', 'url|mime|extmetadata');
  url.searchParams.set('iiurlwidth', '480');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) {
    throw new Error(`Wikimedia Commons returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          pageid: number;
          title: string;
          coordinates?: Array<{ lat: number; lon: number }>;
          imageinfo?: Array<{
            thumburl?: string;
            url?: string;
            descriptionurl?: string;
            mime?: string;
            extmetadata?: Record<string, { value?: string }>;
          }>;
        }
      >;
    };
  };

  const pages = Object.values(data.query?.pages || {});
  const results: WikimediaReferencePhoto[] = [];

  for (const page of pages) {
    const ii = page.imageinfo?.[0];
    const coord = page.coordinates?.[0];
    if (!ii || !coord) continue;
    if (!ii.mime || !ii.mime.startsWith('image/')) continue;

    const license = ii.extmetadata?.LicenseShortName?.value || '';
    const isPermitted = COMMERCIAL_SAFE_LICENSES.some((allowed) =>
      license.toLowerCase().includes(allowed.toLowerCase())
    );
    if (!isPermitted) continue;

    const thumbUrl = ii.thumburl || ii.url;
    if (!thumbUrl) continue;

    const distKm = haversineKm(lat, lon, coord.lat, coord.lon);
    results.push({
      pageId: page.pageid,
      title: page.title.replace(/^File:/, ''),
      lat: coord.lat,
      lon: coord.lon,
      distanceMeters: Math.round(distKm * 1000),
      thumbUrl,
      pageUrl:
        ii.descriptionurl ||
        `https://commons.wikimedia.org/?curid=${page.pageid}`,
      license,
      artist: stripHtml(ii.extmetadata?.Artist?.value || 'Wikimedia Commons contributor'),
    });
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return results.slice(0, limit);
}
