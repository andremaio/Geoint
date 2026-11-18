import type {
  AmbiguityAssessment,
  ExifMetadataSummary,
  GeoHypothesis,
  OcrExtractionResult,
} from '../types/geoint';
import { findNearestPlace, isDistinctiveOcrToponym } from './gazetteer';
import { haversineKm } from './geoMath';
import { analyzeSolarConsistency } from './solar';

export interface ScoredCoordinate {
  lat: number;
  lon: number;
  logit: number;
  prob: number;
}

export interface SpatialCluster {
  lat: number;
  lon: number;
  peakLat: number;
  peakLon: number;
  massProb: number;
  peakLogit: number;
  supportPointsCount: number;
  clusterRadiusKm: number;
}

function approximateRegionBucket(lat: number, lon: number): string {
  if (lat > 34 && lat < 72 && lon >= -25 && lon <= 45) return 'EU';
  if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 55) return 'AF';
  if (lat >= 15 && lon >= -170 && lon <= -50) return 'NA';
  if (lat < 15 && lon >= -90 && lon <= -30) return 'SA';
  if (lat < -10 && lon >= 110 && lon <= 180) return 'OC';
  if (lat < -60) return 'AN';
  return 'AS';
}

/**
 * Preserve provenance while sorting investigation leads. Explicit source evidence
 * outranks weak visual affinity, but an OCR pin remains an unverified lead.
 * No synthetic percentages or claimed location probabilities are introduced.
 */
export function rankHypothesesByEvidence(hypotheses: GeoHypothesis[]): GeoHypothesis[] {
  const strength = (h: GeoHypothesis): number => {
    if (h.source === 'exif_gps') return 100;
    if (h.source === 'manual_override') return 90;
    if (h.verifiedByInvestigator) return 85;
    if (h.source === 'visual_model' && h.matchedTextClues.length > 0) return 75;
    // A text-only match is an unverified lead, never stronger than a visual
    // result or independently corroborated evidence.
    if (h.source === 'ocr_gazetteer') return 25;
    if (h.source === 'visual_model') return 40;
    return 20;
  };
  return [...hypotheses]
    .sort((a, b) => strength(b) - strength(a) || a.rank - b.rank)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

export function clusterSpatialHypotheses(
  points: ScoredCoordinate[],
  clusterRadiusKm = 50,
  maxClusters = 5
): {
  clusters: SpatialCluster[];
  spatialSpreadKm: number;
  distinctContinentsCount: number;
} {
  const sorted = [...points].sort((a, b) => b.logit - a.logit);
  const buckets: Array<{
    peakLat: number;
    peakLon: number;
    peakLogit: number;
    massProb: number;
    weightedLat: number;
    weightedLon: number;
    weightSum: number;
    members: ScoredCoordinate[];
    maxDistKm: number;
  }> = [];

  for (const p of sorted) {
    let matched: (typeof buckets)[number] | null = null;
    for (const c of buckets) {
      if (haversineKm(c.peakLat, c.peakLon, p.lat, p.lon) <= clusterRadiusKm) {
        matched = c;
        break;
      }
    }
    const weight = Math.max(1e-8, p.prob);
    if (matched) {
      matched.massProb += p.prob;
      matched.weightedLat += p.lat * weight;
      matched.weightedLon += p.lon * weight;
      matched.weightSum += weight;
      matched.members.push(p);
      const d = haversineKm(matched.peakLat, matched.peakLon, p.lat, p.lon);
      if (d > matched.maxDistKm) matched.maxDistKm = d;
    } else {
      buckets.push({
        peakLat: p.lat,
        peakLon: p.lon,
        peakLogit: p.logit,
        massProb: p.prob,
        weightedLat: p.lat * weight,
        weightedLon: p.lon * weight,
        weightSum: weight,
        members: [p],
        maxDistKm: 0,
      });
    }
  }

  buckets.sort((a, b) => b.massProb - a.massProb);

  const clusters: SpatialCluster[] = buckets.slice(0, maxClusters).map((b) => {
    // Check antimeridian safety before weighted averaging longitude
    const crossesDateline = b.members.some((m) => Math.abs(m.lon - b.peakLon) > 180);
    const centroidLat = crossesDateline ? b.peakLat : b.weightedLat / Math.max(1e-9, b.weightSum);
    const centroidLon = crossesDateline ? b.peakLon : b.weightedLon / Math.max(1e-9, b.weightSum);
    return {
      lat: Number(centroidLat.toFixed(5)),
      lon: Number(centroidLon.toFixed(5)),
      peakLat: Number(b.peakLat.toFixed(5)),
      peakLon: Number(b.peakLon.toFixed(5)),
      massProb: b.massProb,
      peakLogit: b.peakLogit,
      supportPointsCount: b.members.length,
      clusterRadiusKm: Number(Math.max(0.5, b.maxDistKm).toFixed(1)),
    };
  });

  let spatialSpreadKm = 0;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const d = haversineKm(clusters[i].lat, clusters[i].lon, clusters[j].lat, clusters[j].lon);
      if (d > spatialSpreadKm) spatialSpreadKm = d;
    }
  }

  const regions = new Set(clusters.map((c) => approximateRegionBucket(c.lat, c.lon)));

  return {
    clusters,
    spatialSpreadKm: Number(spatialSpreadKm.toFixed(0)),
    distinctContinentsCount: regions.size,
  };
}

/**
 * Calibrated ambiguity & inconclusive rejection rules derived empirically
 * against benchmarked outdoor landmarks, landscapes, indoor scenes, and featureless images.
 */
export function assessAmbiguity(params: {
  hasGps: boolean;
  top1Mass: number;
  top1PeakLogit: number;
  top1ToTop2Ratio: number;
  spatialSpreadKm: number;
  distinctContinentsCount: number;
  hasCorroboration?: boolean;
  hasVisualClusters?: boolean;
}): AmbiguityAssessment {
  const {
    hasGps,
    top1Mass,
    top1PeakLogit,
    top1ToTop2Ratio,
    spatialSpreadKm,
    distinctContinentsCount,
    hasCorroboration = false,
    hasVisualClusters = true,
  } = params;

  const reasons: string[] = [];

  if (hasGps) {
    reasons.push('EXIF GPS coordinates extracted directly from original file metadata.');
    if (hasVisualClusters && top1PeakLogit > 0) {
      reasons.push(
        `Visual neural check ran alongside metadata (top cluster affinity ${(top1Mass * 100).toFixed(1)}%).`
      );
    }
    return {
      classification: 'gps_metadata',
      isAmbiguous: false,
      isInconclusive: false,
      reasons,
      metrics: {
        top1Mass,
        top1PeakLogit,
        top1ToTop2Ratio,
        spatialSpreadKm,
        distinctContinentsCount,
      },
    };
  }

  if (!hasVisualClusters) {
    reasons.push('Visual neural inference was skipped or did not complete; no GPS coordinates embedded.');
    return {
      classification: 'inconclusive',
      isAmbiguous: true,
      isInconclusive: true,
      reasons,
      metrics: {
        top1Mass: 0,
        top1PeakLogit: 0,
        top1ToTop2Ratio: 0,
        spatialSpreadKm: 0,
        distinctContinentsCount: 0,
      },
    };
  }

  // Inconclusive thresholds grounded in Phase B empirical benchmark:
  // - Outdoor identifiable shots: peakLogit 9.44..22.16, top1Mass 0.237..0.998
  // - Interior / featureless images: peakLogit 3.61..6.30, top1Mass 0.005..0.019
  const weakPeak = top1PeakLogit < 8.0;
  const flatSoftmax = top1Mass < 0.06;
  const dispersedWeak = top1Mass < 0.15 && top1ToTop2Ratio < 1.8 && spatialSpreadKm > 1500;

  if (weakPeak) {
    reasons.push(`Low peak embedding similarity (logit ${top1PeakLogit.toFixed(2)} < 8.0 threshold).`);
  }
  if (flatSoftmax) {
    reasons.push(`Diffuse global affinity (top cluster ${(top1Mass * 100).toFixed(1)}% < 6.0%).`);
  }
  if (dispersedWeak) {
    reasons.push(`Competing hypotheses spread across ${spatialSpreadKm.toLocaleString()} km without strong margin.`);
  }

  const isInconclusive = weakPeak || flatSoftmax || dispersedWeak;

  if (isInconclusive) {
    return {
      classification: 'inconclusive',
      isAmbiguous: true,
      isInconclusive: true,
      reasons,
      metrics: {
        top1Mass,
        top1PeakLogit,
        top1ToTop2Ratio,
        spatialSpreadKm,
        distinctContinentsCount,
      },
    };
  }

  // Non-inconclusive: evaluate moderate spatial ambiguity
  const isAmbiguous =
    top1Mass < 0.5 ||
    top1ToTop2Ratio < 3.5 ||
    (distinctContinentsCount >= 2 && top1Mass < 0.75);

  if (isAmbiguous) {
    if (top1Mass < 0.5) {
      reasons.push(`Top cluster captures ${(top1Mass * 100).toFixed(1)}% relative share; alternative regions remain plausible.`);
    }
    if (top1ToTop2Ratio < 3.5) {
      reasons.push(`Narrow separation margin (${top1ToTop2Ratio.toFixed(1)}x) against second hypothesis.`);
    }
    if (distinctContinentsCount >= 2 && spatialSpreadKm > 800) {
      reasons.push(`Candidates span ${distinctContinentsCount} broad macro-regions (${spatialSpreadKm.toLocaleString()} km).`);
    }
  } else {
    reasons.push(`Single dominant spatial cluster (${(top1Mass * 100).toFixed(1)}% relative share; margin ${top1ToTop2Ratio >= 100 ? '>100x' : `${top1ToTop2Ratio.toFixed(1)}x`}).`);
  }

  return {
    classification: hasCorroboration ? 'evidence_corroborated' : 'visual_estimate',
    isAmbiguous,
    isInconclusive: false,
    reasons,
    metrics: {
      top1Mass,
      top1PeakLogit,
      top1ToTop2Ratio,
      spatialSpreadKm,
      distinctContinentsCount,
    },
  };
}

export async function buildHypothesesFromResults(params: {
  clusters: SpatialCluster[];
  spatialSpreadKm: number;
  distinctContinentsCount: number;
  metadata: ExifMetadataSummary;
  ocr?: OcrExtractionResult;
  observedShadowAzimuthDeg?: number;
  manualTimestampIso?: string;
}): Promise<{
  hypotheses: GeoHypothesis[];
  ambiguity: AmbiguityAssessment;
}> {
  const {
    clusters,
    spatialSpreadKm,
    distinctContinentsCount,
    metadata,
    ocr,
    observedShadowAzimuthDeg,
    manualTimestampIso,
  } = params;

  const effectiveTimestamp = manualTimestampIso || metadata.dateTimeOriginal || metadata.gps?.timestampIso;
  const reliableOcrMatches = ocr?.status === 'complete'
    ? ocr.matchedGazetteerPlaces.filter((m) => isDistinctiveOcrToponym(m.token))
    : [];
  const hypotheses: GeoHypothesis[] = [];

  if (metadata.hasGps && metadata.gps) {
    const gpsNearest = await findNearestPlace(metadata.gps.lat, metadata.gps.lon);
    const gpsSolar = analyzeSolarConsistency({
      lat: metadata.gps.lat,
      lon: metadata.gps.lon,
      timestampIso: effectiveTimestamp,
      observedShadowAzimuthDeg,
    });
    const notes: string[] = ['Derived from file EXIF GPS IFD header.'];
    if (metadata.gps.altitudeMeters !== undefined) {
      notes.push(`Reported GPS altitude: ${metadata.gps.altitudeMeters} m.`);
    }
    hypotheses.push({
      id: 'hyp-exif-gps',
      rank: 1,
      source: 'exif_gps',
      lat: metadata.gps.lat,
      lon: metadata.gps.lon,
      relativeAffinity: 1,
      peakLogit: 0,
      supportPointsCount: 1,
      clusterRadiusKm: 0.1,
      nearestPlace: gpsNearest,
      matchedTextClues: [],
      solarCheck: gpsSolar,
      corroborationNotes: notes,
    });
  }

  const maxVisual = metadata.hasGps ? Math.min(4, clusters.length) : Math.min(5, clusters.length);
  for (let i = 0; i < maxVisual; i++) {
    const c = clusters[i];
    const nearest = await findNearestPlace(c.lat, c.lon);
    const solar = analyzeSolarConsistency({
      lat: c.lat,
      lon: c.lon,
      timestampIso: effectiveTimestamp,
      observedShadowAzimuthDeg,
    });

    const notes: string[] = [];
    const matchedTextClues: string[] = [];

    // Compare against GPS if present
    if (metadata.hasGps && metadata.gps) {
      const deltaKm = haversineKm(metadata.gps.lat, metadata.gps.lon, c.lat, c.lon);
      notes.push(`Distance to EXIF GPS pin: ${deltaKm.toFixed(1)} km.`);
    }

    // Compare distinctive OCR names only within a 25 km vicinity
    if (reliableOcrMatches.length > 0) {
      for (const m of reliableOcrMatches) {
        const dKm = haversineKm(c.lat, c.lon, m.lat, m.lon);
        if (dKm <= 25) {
          matchedTextClues.push(`${m.name} (${m.countryCode})`);
          notes.push(`OCR token "${m.token}" matches gazetteer "${m.name}" (${dKm.toFixed(0)} km away).`);
        }
      }
    }

    if (solar && solar.consistencyLabel === 'consistent') {
      notes.push(`Solar shadow azimuth agrees within ${solar.angularDeltaDeg}°.`);
    } else if (solar && solar.consistencyLabel === 'divergent') {
      notes.push(
        solar.isDaylight
          ? `Solar shadow diverges by ${solar.angularDeltaDeg}° from observed shadow.`
          : 'EXIF timestamp indicates night at this longitude.'
      );
    }

    hypotheses.push({
      id: `hyp-vis-${i + 1}`,
      rank: hypotheses.length + 1,
      source: 'visual_model',
      lat: c.lat,
      lon: c.lon,
      relativeAffinity: Number(c.massProb.toFixed(4)),
      peakLogit: Number(c.peakLogit.toFixed(2)),
      supportPointsCount: c.supportPointsCount,
      clusterRadiusKm: c.clusterRadiusKm,
      nearestPlace: nearest,
      matchedTextClues,
      solarCheck: solar,
      corroborationNotes: notes,
    });
  }

  const top1 = clusters[0];
  const top2 = clusters[1];
  const top1Mass = top1 ? top1.massProb : 0;
  const top1PeakLogit = top1 ? top1.peakLogit : 0;
  const top1ToTop2Ratio =
    top1 && top2 && top2.massProb > 1e-6
      ? Number((top1.massProb / top2.massProb).toFixed(2))
      : top1
        ? 999
        : 0;

  if (reliableOcrMatches.length > 0) {
    let addedOcr = 0;
    for (const m of reliableOcrMatches) {
      const covered = hypotheses.some(
        (h) =>
          haversineKm(h.lat, h.lon, m.lat, m.lon) <= 25 ||
          (h.nearestPlace && h.nearestPlace.name.toLowerCase() === m.name.toLowerCase())
      );
      if (!covered && addedOcr < 2) {
        addedOcr++;
        const solar = analyzeSolarConsistency({
          lat: m.lat,
          lon: m.lon,
          timestampIso: effectiveTimestamp,
          observedShadowAzimuthDeg,
        });
        hypotheses.push({
          id: `hyp-ocr-${addedOcr}`,
          rank: hypotheses.length + 1,
          source: 'ocr_gazetteer',
          lat: Number(m.lat.toFixed(5)),
          lon: Number(m.lon.toFixed(5)),
          relativeAffinity: 0,
          peakLogit: 0,
          supportPointsCount: 1,
          clusterRadiusKm: 2,
          nearestPlace: {
            name: m.name,
            countryCode: m.countryCode,
            countryName: m.countryName,
            region: m.region || '',
            lat: m.lat,
            lon: m.lon,
            population: m.population || 0,
            distanceKm: 0,
            bearingDeg: 0,
            compass: 'N',
          },
          matchedTextClues: [`${m.name} (${m.countryCode})`],
          solarCheck: solar,
          corroborationNotes: [
            `Scene OCR token "${m.token}" matched GeoNames place "${m.name}, ${m.countryName}" (distant from visual clusters; verify sign context).`,
          ],
        });
      }
    }
  }

  const hasCorroboration = hypotheses.some(
    (h) =>
      h.source === 'manual_override' ||
      h.verifiedByInvestigator ||
      ((h.source === 'visual_model' || h.source === 'exif_gps') &&
        (h.matchedTextClues.length > 0 || h.solarCheck?.consistencyLabel === 'consistent'))
  );

  const ambiguity = assessAmbiguity({
    hasGps: metadata.hasGps,
    top1Mass,
    top1PeakLogit,
    top1ToTop2Ratio,
    spatialSpreadKm,
    distinctContinentsCount,
    hasCorroboration,
    hasVisualClusters: clusters.length > 0,
  });

  return { hypotheses: rankHypothesesByEvidence(hypotheses), ambiguity };
}

/**
 * Re-evaluates existing hypotheses when secondary forensic evidence changes
 * (OCR extracted, solar timestamp/shadow added, manual verification toggled).
 */
export function reevaluateHypothesesEvidence(
  existing: GeoHypothesis[],
  currentAmbiguity: AmbiguityAssessment,
  params: {
    metadata: ExifMetadataSummary;
    ocr?: OcrExtractionResult;
    observedShadowAzimuthDeg?: number;
    manualTimestampIso?: string;
  }
): {
  hypotheses: GeoHypothesis[];
  ambiguity: AmbiguityAssessment;
} {
  const { metadata, ocr, observedShadowAzimuthDeg, manualTimestampIso } = params;
  const effectiveTimestamp = manualTimestampIso || metadata.dateTimeOriginal || metadata.gps?.timestampIso;
  const reliableOcrMatches = ocr?.status === 'complete'
    ? ocr.matchedGazetteerPlaces.filter((m) => isDistinctiveOcrToponym(m.token))
    : [];

  const baseHypotheses = existing.filter((h) => h.source !== 'ocr_gazetteer');

  const updated: GeoHypothesis[] = baseHypotheses.map((h) => {
    const notes = h.corroborationNotes.filter(
      (n) => !n.startsWith('OCR token') && !n.startsWith('Solar shadow') && !n.startsWith('EXIF timestamp indicates night')
    );
    const matchedTextClues: string[] = [];

    if (reliableOcrMatches.length > 0) {
      for (const m of reliableOcrMatches) {
        const dKm = haversineKm(h.lat, h.lon, m.lat, m.lon);
        if (dKm <= 25) {
          matchedTextClues.push(`${m.name} (${m.countryCode})`);
          notes.push(`OCR token "${m.token}" matches "${m.name}" (${dKm.toFixed(0)} km).`);
        }
      }
    }

    const solarCheck = analyzeSolarConsistency({
      lat: h.lat,
      lon: h.lon,
      timestampIso: effectiveTimestamp,
      observedShadowAzimuthDeg,
    });

    if (solarCheck && solarCheck.consistencyLabel === 'consistent') {
      notes.push(`Solar shadow azimuth agrees within ${solarCheck.angularDeltaDeg}°.`);
    } else if (solarCheck && solarCheck.consistencyLabel === 'divergent') {
      notes.push(
        solarCheck.isDaylight
          ? `Solar shadow diverges by ${solarCheck.angularDeltaDeg}° from observed shadow.`
          : 'Timestamp falls during night at this longitude.'
      );
    }

    return {
      ...h,
      matchedTextClues,
      solarCheck,
      corroborationNotes: notes,
    };
  });

  if (reliableOcrMatches.length > 0) {
    let addedOcr = 0;
    for (const m of reliableOcrMatches) {
      const covered = updated.some(
        (h) =>
          haversineKm(h.lat, h.lon, m.lat, m.lon) <= 25 ||
          (h.nearestPlace && h.nearestPlace.name.toLowerCase() === m.name.toLowerCase())
      );
      if (!covered && addedOcr < 2) {
        addedOcr++;
        const solarCheck = analyzeSolarConsistency({
          lat: m.lat,
          lon: m.lon,
          timestampIso: effectiveTimestamp,
          observedShadowAzimuthDeg,
        });
        updated.push({
          id: `hyp-ocr-${addedOcr}`,
          rank: updated.length + 1,
          source: 'ocr_gazetteer',
          lat: Number(m.lat.toFixed(5)),
          lon: Number(m.lon.toFixed(5)),
          relativeAffinity: 0,
          peakLogit: 0,
          supportPointsCount: 1,
          clusterRadiusKm: 2,
          nearestPlace: {
            name: m.name,
            countryCode: m.countryCode,
            countryName: m.countryName,
            region: m.region || '',
            lat: m.lat,
            lon: m.lon,
            population: m.population || 0,
            distanceKm: 0,
            bearingDeg: 0,
            compass: 'N',
          },
          matchedTextClues: [`${m.name} (${m.countryCode})`],
          solarCheck,
          corroborationNotes: [
            `Scene OCR token "${m.token}" matched GeoNames place "${m.name}, ${m.countryName}" (distant from visual clusters; verify sign context).`,
          ],
        });
      }
    }
  }

  const ranked = rankHypothesesByEvidence(updated);

  const hasCorroboration = ranked.some(
    (h) =>
      h.source === 'manual_override' ||
      h.verifiedByInvestigator ||
      ((h.source === 'visual_model' || h.source === 'exif_gps') &&
        (h.matchedTextClues.length > 0 || h.solarCheck?.consistencyLabel === 'consistent'))
  );

  const ambiguity = assessAmbiguity({
    hasGps: metadata.hasGps,
    top1Mass: currentAmbiguity.metrics.top1Mass,
    top1PeakLogit: currentAmbiguity.metrics.top1PeakLogit,
    top1ToTop2Ratio: currentAmbiguity.metrics.top1ToTop2Ratio,
    spatialSpreadKm: currentAmbiguity.metrics.spatialSpreadKm,
    distinctContinentsCount: currentAmbiguity.metrics.distinctContinentsCount,
    hasCorroboration,
    hasVisualClusters: ranked.some((h) => h.source === 'visual_model'),
  });

  return { hypotheses: ranked, ambiguity };
}
