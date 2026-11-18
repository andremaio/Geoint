import { getPosition } from 'suncalc';
import type { SolarAnalysis } from '../types/geoint';

/**
 * Normalize SunCalc 2.x azimuth (already in degrees, North-based clockwise:
 * 0° = N, 90° = E, 180° = S, 270° = W) to [0, 360).
 * Note: @types/suncalc@1.9.x documents the legacy 1.x radians-from-South API,
 * whereas suncalc@2.x returns degrees North-clockwise for azimuth and degrees for altitude.
 */
function normalizeCompassDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestAngularDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function analyzeSolarConsistency(params: {
  lat: number;
  lon: number;
  timestampIso?: string;
  observedShadowAzimuthDeg?: number;
}): SolarAnalysis | undefined {
  if (!params.timestampIso) return undefined;
  const date = new Date(params.timestampIso);
  if (Number.isNaN(date.getTime())) return undefined;

  const pos = getPosition(date, params.lat, params.lon);
  const sunAltitudeDeg = Number(pos.altitude.toFixed(2));
  const sunAzimuthDeg = Number(normalizeCompassDeg(pos.azimuth).toFixed(1));
  const expectedShadowDirectionDeg = Number(((sunAzimuthDeg + 180) % 360).toFixed(1));
  const isDaylight = sunAltitudeDeg > -0.833;

  let angularDeltaDeg: number | undefined;
  let consistencyLabel: SolarAnalysis['consistencyLabel'] = 'insufficient_data';

  if (typeof params.observedShadowAzimuthDeg === 'number' && Number.isFinite(params.observedShadowAzimuthDeg)) {
    if (!isDaylight) {
      consistencyLabel = 'divergent';
      angularDeltaDeg = Number(
        shortestAngularDiff(expectedShadowDirectionDeg, params.observedShadowAzimuthDeg).toFixed(1)
      );
    } else {
      angularDeltaDeg = Number(
        shortestAngularDiff(expectedShadowDirectionDeg, params.observedShadowAzimuthDeg).toFixed(1)
      );
      if (angularDeltaDeg <= 22) {
        consistencyLabel = 'consistent';
      } else if (angularDeltaDeg <= 45) {
        consistencyLabel = 'plausible';
      } else {
        consistencyLabel = 'divergent';
      }
    }
  } else if (!isDaylight) {
    // Useful check even without shadow measurement if photo is clearly broad daylight
    consistencyLabel = 'plausible';
  }

  return {
    timestampIso: date.toISOString(),
    sunAltitudeDeg,
    sunAzimuthDeg,
    expectedShadowDirectionDeg,
    observedShadowAzimuthDeg: params.observedShadowAzimuthDeg,
    angularDeltaDeg,
    isDaylight,
    consistencyLabel,
  };
}
