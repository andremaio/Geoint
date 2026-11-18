import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assessAmbiguity,
  clusterSpatialHypotheses,
  reevaluateHypothesesEvidence,
} from '../src/engine/candidates';
import { matchTokensToGazetteer } from '../src/engine/gazetteer';
import {
  bearingToCompass,
  destinationPoint,
  formatCoordPair,
  haversineKm,
  initialBearingDeg,
  intersectBearingRays,
} from '../src/engine/geoMath';
import { computeSha256Hex, validateAndIngestImage } from '../src/engine/ingest';
import { extractImageMetadata } from '../src/engine/metadata';
import { analyzeSolarConsistency } from '../src/engine/solar';
import type { GeoHypothesis } from '../src/types/geoint';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

describe('CRIMNEX GEOINT Geospatial Math', () => {
  it('computes accurate Haversine distances and bearings', () => {
    // Lisbon to Paris ~1,454 km, initial bearing ~35.43 deg (NE)
    const dist = haversineKm(38.7223, -9.1393, 48.8566, 2.3522);
    expect(dist).toBeGreaterThan(1445);
    expect(dist).toBeLessThan(1465);

    const brg = initialBearingDeg(38.7223, -9.1393, 48.8566, 2.3522);
    expect(brg).toBeGreaterThan(33);
    expect(brg).toBeLessThan(38);
    expect(bearingToCompass(brg)).toBe('NE');
  });

  it('converges spherical triangulation rays accurately to known intersection point', () => {
    const targetLat = 38.6916;
    const targetLon = -9.216;
    const obs1 = destinationPoint(targetLat, targetLon, 120, 8.0);
    const obs2 = destinationPoint(targetLat, targetLon, 245, 6.5);

    const ray1Bearing = initialBearingDeg(obs1[0], obs1[1], targetLat, targetLon);
    const ray2Bearing = initialBearingDeg(obs2[0], obs2[1], targetLat, targetLon);

    const intersection = intersectBearingRays(
      obs1[0],
      obs1[1],
      ray1Bearing,
      obs2[0],
      obs2[1],
      ray2Bearing
    );
    expect(intersection).not.toBeNull();
    expect(haversineKm(targetLat, targetLon, intersection!.lat, intersection!.lon)).toBeLessThan(0.05);
  });

  it('formats cardinal coordinates cleanly', () => {
    expect(formatCoordPair(38.6916, -9.216)).toBe('38.6916° N, 9.2160° W');
    expect(formatCoordPair(-33.9628, 18.4098)).toBe('33.9628° S, 18.4098° E');
  });
});

describe('Image Forensic Ingestion & Metadata Extraction', () => {
  it('blocks disguised SVG/XML active payloads', async () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const fakeJpg = new File([svgBytes], 'payload.jpg', { type: 'image/jpeg' });
    const { validation } = await validateAndIngestImage(fakeJpg);
    expect(validation.valid).toBe(false);
    expect(validation.detectedSignature).toContain('SVG/XML');
    expect(validation.error).toBe('ERR_UNSUPPORTED_SIGNATURE');
  });

  it('rejects empty and oversized files cleanly while preserving SHA-256 determinism', async () => {
    const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });
    const emptyRes = await validateAndIngestImage(emptyFile);
    expect(emptyRes.validation.valid).toBe(false);
    expect(emptyRes.validation.error).toBe('ERR_EMPTY_FILE');

    const buf = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const h1 = await computeSha256Hex(buf);
    const h2 = await computeSha256Hex(buf);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('extracts valid EXIF/GPS headers from GPS fixture and reports absence on clean PNG', async () => {
    const gpsBytes = await fs.readFile(path.join(FIXTURES_DIR, 'belem_with_gps.jpg'));
    const gpsBuf = gpsBytes.buffer.slice(gpsBytes.byteOffset, gpsBytes.byteOffset + gpsBytes.byteLength);
    const gpsMeta = await extractImageMetadata(gpsBuf);

    expect(gpsMeta.hasExif).toBe(true);
    expect(gpsMeta.hasGps).toBe(true);
    expect(gpsMeta.gps).not.toBeNull();
    expect(gpsMeta.gps!.lat).toBeCloseTo(38.6916, 3);
    expect(gpsMeta.gps!.lon).toBeCloseTo(-9.216, 3);
    expect(gpsMeta.cameraMake).toBe('CRIMNEX Lab');

    const blankBytes = await fs.readFile(path.join(FIXTURES_DIR, 'featureless_gradient.png'));
    const blankBuf = blankBytes.buffer.slice(blankBytes.byteOffset, blankBytes.byteOffset + blankBytes.byteLength);
    const blankMeta = await extractImageMetadata(blankBuf);

    expect(blankMeta.hasGps).toBe(false);
    expect(blankMeta.gps).toBeNull();
  });
});

describe('Solar Azimuth Verification', () => {
  it('computes daylight consistency across cardinal directions and flags divergence accurately', () => {
    // Solar noon near summer solstice in Lisbon (~12:37 UTC due to -9.2° lon): Sun due South (~178°), shadow due North (~358.5°)
    const noonConsistent = analyzeSolarConsistency({
      lat: 38.6916,
      lon: -9.216,
      timestampIso: '2025-06-21T12:37:00.000Z',
      observedShadowAzimuthDeg: 2,
    });
    expect(noonConsistent).toBeDefined();
    expect(noonConsistent!.isDaylight).toBe(true);
    expect(noonConsistent!.sunAltitudeDeg).toBeGreaterThan(70);
    expect(noonConsistent!.sunAltitudeDeg).toBeLessThan(80);
    expect(noonConsistent!.sunAzimuthDeg).toBeGreaterThan(170);
    expect(noonConsistent!.sunAzimuthDeg).toBeLessThan(190);
    expect(noonConsistent!.consistencyLabel).toBe('consistent');

    // Morning Lisbon June 21 (08:00 UTC): Sun in East (~83°), shadow West (~263°)
    const morningWestShadow = analyzeSolarConsistency({
      lat: 38.6916,
      lon: -9.216,
      timestampIso: '2025-06-21T08:00:00.000Z',
      observedShadowAzimuthDeg: 262,
    });
    expect(morningWestShadow!.sunAzimuthDeg).toBeGreaterThan(75);
    expect(morningWestShadow!.sunAzimuthDeg).toBeLessThan(95);
    expect(morningWestShadow!.consistencyLabel).toBe('consistent');

    // Evening Lisbon June 21 (18:00 UTC): Sun in West (~283°), shadow East (~103°)
    const eveningEastShadow = analyzeSolarConsistency({
      lat: 38.6916,
      lon: -9.216,
      timestampIso: '2025-06-21T18:00:00.000Z',
      observedShadowAzimuthDeg: 103,
    });
    expect(eveningEastShadow!.sunAzimuthDeg).toBeGreaterThan(270);
    expect(eveningEastShadow!.sunAzimuthDeg).toBeLessThan(295);
    expect(eveningEastShadow!.consistencyLabel).toBe('consistent');

    // Southern hemisphere Sydney noon Dec 21 (~01:55 UTC): Sun North (~358°), shadow South (~178°)
    const sydneyNoon = analyzeSolarConsistency({
      lat: -33.8688,
      lon: 151.2093,
      timestampIso: '2025-12-21T01:55:00.000Z',
      observedShadowAzimuthDeg: 178,
    });
    expect(sydneyNoon!.sunAltitudeDeg).toBeGreaterThan(75);
    expect(sydneyNoon!.sunAltitudeDeg).toBeLessThan(85);
    expect(sydneyNoon!.consistencyLabel).toBe('consistent');

    // Divergent shadow pointing South at solar noon in Lisbon
    const divergent = analyzeSolarConsistency({
      lat: 38.6916,
      lon: -9.216,
      timestampIso: '2025-06-21T12:37:00.000Z',
      observedShadowAzimuthDeg: 180,
    });
    expect(divergent!.consistencyLabel).toBe('divergent');

    // Midnight UTC check at Lisbon
    const night = analyzeSolarConsistency({
      lat: 38.6916,
      lon: -9.216,
      timestampIso: '2025-06-21T01:00:00.000Z',
      observedShadowAzimuthDeg: 10,
    });
    expect(night!.isDaylight).toBe(false);
    expect(night!.sunAltitudeDeg).toBeLessThan(-20);
    expect(night!.consistencyLabel).toBe('divergent');
  });
});

describe('Spatial Clustering, Ambiguity & Inconclusive Rejection', () => {
  it('groups nearby candidate coordinates within 50 km and separates distinct regions', () => {
    const clustered = clusterSpatialHypotheses(
      [
        { lat: 38.6916, lon: -9.216, logit: 18.0, prob: 0.6 },
        { lat: 38.71, lon: -9.14, logit: 17.2, prob: 0.25 }, // ~7 km from Belém
        { lat: 41.14, lon: -8.61, logit: 14.1, prob: 0.08 }, // ~275 km north (Porto)
        { lat: 48.85, lon: 2.29, logit: 12.0, prob: 0.04 }, // Paris (~1450 km)
      ],
      50,
      5
    );

    expect(clustered.clusters).toHaveLength(3);
    expect(clustered.clusters[0].supportPointsCount).toBe(2);
    expect(clustered.clusters[0].massProb).toBeCloseTo(0.85, 2);
    expect(clustered.spatialSpreadKm).toBeGreaterThan(1400);
  });

  it('rejects empirical indoor and featureless logits as inconclusive while accepting outdoor landmarks', () => {
    // Indoor coffee scene from bench-q4.json
    const indoor = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.0187,
      top1PeakLogit: 6.3,
      top1ToTop2Ratio: 1.91,
      spatialSpreadKm: 1300,
      distinctContinentsCount: 1,
    });
    expect(indoor.classification).toBe('inconclusive');
    expect(indoor.isInconclusive).toBe(true);

    // Featureless gradient from bench-q4.json
    const featureless = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.0052,
      top1PeakLogit: 3.61,
      top1ToTop2Ratio: 1.99,
      spatialSpreadKm: 5600,
      distinctContinentsCount: 2,
    });
    expect(featureless.classification).toBe('inconclusive');
    expect(featureless.isInconclusive).toBe(true);

    // Golden Gate Bridge (recognizable but with European/NY bridge echoes) -> ambiguous visual_estimate
    const goldenGate = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.3367,
      top1PeakLogit: 9.44,
      top1ToTop2Ratio: 3.01,
      spatialSpreadKm: 8900,
      distinctContinentsCount: 3,
    });
    expect(goldenGate.classification).toBe('visual_estimate');
    expect(goldenGate.isInconclusive).toBe(false);
    expect(goldenGate.isAmbiguous).toBe(true);

    // Torre de Belém -> strong uncorroborated visual_estimate
    const belem = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.9006,
      top1PeakLogit: 17.97,
      top1ToTop2Ratio: 31.06,
      spatialSpreadKm: 2300,
      distinctContinentsCount: 1,
    });
    expect(belem.classification).toBe('visual_estimate');
    expect(belem.isInconclusive).toBe(false);
    expect(belem.isAmbiguous).toBe(false);

    // Device EXIF GPS always classified transparently as gps_metadata
    const gps = assessAmbiguity({
      hasGps: true,
      top1Mass: 0.9006,
      top1PeakLogit: 17.97,
      top1ToTop2Ratio: 31.06,
      spatialSpreadKm: 0,
      distinctContinentsCount: 1,
    });
    expect(gps.classification).toBe('gps_metadata');
    expect(gps.isInconclusive).toBe(false);
  });

  it('upgrades visual_estimate to evidence_corroborated when OCR gazetteer clue matches nearby', () => {
    const initialHyp: GeoHypothesis[] = [
      {
        id: 'hyp-vis-1',
        rank: 1,
        source: 'visual_model',
        lat: 38.6965,
        lon: -9.2074,
        relativeAffinity: 0.9006,
        peakLogit: 17.97,
        supportPointsCount: 194,
        clusterRadiusKm: 8,
        nearestPlace: {
          name: 'Lisbon',
          countryCode: 'PT',
          countryName: 'Portugal',
          region: 'Lisbon',
          lat: 38.7167,
          lon: -9.1333,
          population: 517802,
          distanceKm: 6.8,
          bearingDeg: 250,
          compass: 'WSW',
        },
        matchedTextClues: [],
        corroborationNotes: [],
      },
    ];

    const baseAmb = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.9006,
      top1PeakLogit: 17.97,
      top1ToTop2Ratio: 31.06,
      spatialSpreadKm: 300,
      distinctContinentsCount: 1,
    });

    const upgraded = reevaluateHypothesesEvidence(initialHyp, baseAmb, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr: {
        status: 'complete',
        progress: 100,
        language: 'por',
        rawText: 'Torre de Belem Lisboa',
        tokens: ['Torre', 'Belem', 'Lisboa'],
        matchedGazetteerPlaces: [
          {
            token: 'lisboa',
            name: 'Lisbon',
            countryCode: 'PT',
            countryName: 'Portugal',
            lat: 38.7167,
            lon: -9.1333,
          },
        ],
      },
    });

    expect(upgraded.ambiguity.classification).toBe('evidence_corroborated');
    expect(upgraded.hypotheses[0].matchedTextClues).toContain('Lisbon (PT)');
  });

  it('adds standalone ocr_gazetteer lead for distant OCR toponym without inflating classification, and cleans stale OCR leads on re-run', () => {
    const initialHyp: GeoHypothesis[] = [
      {
        id: 'hyp-vis-1',
        rank: 1,
        source: 'visual_model',
        lat: 46.5806,
        lon: 0.3499,
        relativeAffinity: 0.12,
        peakLogit: 13.54,
        supportPointsCount: 9,
        clusterRadiusKm: 4,
        nearestPlace: {
          name: 'Poitiers',
          countryCode: 'FR',
          countryName: 'France',
          region: 'New Aquitaine',
          lat: 46.5802,
          lon: 0.3404,
          population: 86000,
          distanceKm: 0.5,
          bearingDeg: 85,
          compass: 'E',
        },
        matchedTextClues: [],
        corroborationNotes: [],
      },
    ];

    const baseAmb = assessAmbiguity({
      hasGps: false,
      top1Mass: 0.12,
      top1PeakLogit: 13.54,
      top1ToTop2Ratio: 1.33,
      spatialSpreadKm: 600,
      distinctContinentsCount: 1,
    });

    const withDistantOcr = reevaluateHypothesesEvidence(initialHyp, baseAmb, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr: {
        status: 'complete',
        progress: 100,
        language: 'fra',
        rawText: 'D 127 ARCUEIL',
        tokens: ['ARCUEIL'],
        matchedGazetteerPlaces: [
          {
            token: 'arcueil',
            name: 'Arcueil',
            countryCode: 'FR',
            countryName: 'France',
            region: 'Île-de-France',
            population: 21500,
            lat: 48.8053,
            lon: 2.3338,
          },
        ],
      },
    });

    expect(withDistantOcr.ambiguity.classification).toBe('visual_estimate');
    expect(withDistantOcr.hypotheses).toHaveLength(2);
    // The independent OCR toponym is now prioritised above a weak visual
    // lead, while remaining explicitly unverified and without synthetic score.
    expect(withDistantOcr.hypotheses[1].source).toBe('ocr_gazetteer');
    expect(withDistantOcr.hypotheses[1].nearestPlace?.name).toBe('Arcueil');
    expect(withDistantOcr.hypotheses[1].relativeAffinity).toBe(0);
    expect(withDistantOcr.hypotheses[0].matchedTextClues).toHaveLength(0);

    // Re-running with empty OCR clears stale hyp-ocr leads
    const cleared = reevaluateHypothesesEvidence(withDistantOcr.hypotheses, withDistantOcr.ambiguity, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr: {
        status: 'complete',
        progress: 100,
        language: 'fra',
        rawText: '',
        tokens: [],
        matchedGazetteerPlaces: [],
      },
    });
    expect(cleared.hypotheses).toHaveLength(1);
    expect(cleared.hypotheses[0].id).toBe('hyp-vis-1');
  });

  it('indexes full GeoNames gazetteer via hash map without starving valid toponyms behind >100 noise tokens', async () => {
    const gazJson = await fs.readFile(path.resolve(process.cwd(), 'public/data/gazetteer.json'), 'utf8');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => JSON.parse(gazJson),
      }))
    );

    try {
      const noiseTokens = Array.from({ length: 120 }, (_, i) => `znoise_${String(i).padStart(3, '0')}`);
      const matches = await matchTokensToGazetteer([...noiseTokens, 'THIMPHU', 'arcueil'], 12);
      const names = matches.map((m) => `${m.name}:${m.countryCode}`);
      expect(names).toContain('Thimphu:BT');
      expect(names).toContain('Arcueil:FR');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
