const EARTH_RADIUS_KM = 6371.0088;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceKm: number
): [number, number] {
  const delta = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);
  const normLon = ((toDeg(lambda2) + 540) % 360) - 180;
  return [Number(toDeg(phi2).toFixed(6)), Number(normLon.toFixed(6))];
}

/**
 * Great-circle intersection of two bearing rays on the sphere.
 * Returns null if rays are parallel or intersect behind either origin.
 */
export function intersectBearingRays(
  lat1: number,
  lon1: number,
  bearing1Deg: number,
  lat2: number,
  lon2: number,
  bearing2Deg: number
): { lat: number; lon: number; distFromRay1Km: number; distFromRay2Km: number } | null {
  const phi1 = toRad(lat1);
  const lam1 = toRad(lon1);
  const phi2 = toRad(lat2);
  const lam2 = toRad(lon2);
  const th13 = toRad(bearing1Deg);
  const th23 = toRad(bearing2Deg);

  const dPhi = phi2 - phi1;
  const dLam = lam2 - lam1;
  const delta12 =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin(dPhi / 2) ** 2 +
          Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
      )
    );
  if (delta12 < 1e-8) return null;

  const cosThA = (Math.sin(phi2) - Math.sin(phi1) * Math.cos(delta12)) / (Math.sin(delta12) * Math.cos(phi1));
  const cosThB = (Math.sin(phi1) - Math.sin(phi2) * Math.cos(delta12)) / (Math.sin(delta12) * Math.cos(phi2));
  const thA = Math.acos(Math.max(-1, Math.min(1, cosThA)));
  const thB = Math.acos(Math.max(-1, Math.min(1, cosThB)));

  const th12 = Math.sin(lam2 - lam1) > 0 ? thA : 2 * Math.PI - thA;
  const th21 = Math.sin(lam2 - lam1) > 0 ? 2 * Math.PI - thB : thB;

  const alpha1 = th13 - th12;
  const alpha2 = th21 - th23;

  if (Math.sin(alpha1) === 0 && Math.sin(alpha2) === 0) return null;
  if (Math.sin(alpha1) * Math.sin(alpha2) < 0) return null;

  const alpha3 = Math.acos(
    Math.max(
      -1,
      Math.min(
        1,
        -Math.cos(alpha1) * Math.cos(alpha2) +
          Math.sin(alpha1) * Math.sin(alpha2) * Math.cos(delta12)
      )
    )
  );
  const delta13 = Math.atan2(
    Math.sin(delta12) * Math.sin(alpha1) * Math.sin(alpha2),
    Math.cos(alpha2) + Math.cos(alpha1) * Math.cos(alpha3)
  );
  if (delta13 < 0) return null;

  const phi3 = Math.asin(
    Math.max(
      -1,
      Math.min(
        1,
        Math.sin(phi1) * Math.cos(delta13) +
          Math.cos(phi1) * Math.sin(delta13) * Math.cos(th13)
      )
    )
  );
  const dLam13 = Math.atan2(
    Math.sin(th13) * Math.sin(delta13) * Math.cos(phi1),
    Math.cos(delta13) - Math.sin(phi1) * Math.sin(phi3)
  );
  const lam3 = lam1 + dLam13;

  const resLat = Number(toDeg(phi3).toFixed(6));
  const resLon = Number((((toDeg(lam3) + 540) % 360) - 180).toFixed(6));
  return {
    lat: resLat,
    lon: resLon,
    distFromRay1Km: Number(haversineKm(lat1, lon1, resLat, resLon).toFixed(2)),
    distFromRay2Km: Number(haversineKm(lat2, lon2, resLat, resLon).toFixed(2)),
  };
}

export function bearingToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
  return dirs[idx];
}

export function formatCoordPair(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}
