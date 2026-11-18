import { describe, expect, it } from 'vitest';
import { rankHypothesesByEvidence, reevaluateHypothesesEvidence, assessAmbiguity } from '../src/engine/candidates';
import type { GeoHypothesis, OcrExtractionResult } from '../src/types/geoint';

function lead(id: string, source: GeoHypothesis['source'], affinity: number): GeoHypothesis {
  return {
    id, rank: 1, source, lat: source === 'ocr_gazetteer' ? 41.5324 : 50.8629,
    lon: source === 'ocr_gazetteer' ? -8.6181 : 4.3408, relativeAffinity: affinity,
    peakLogit: 11, supportPointsCount: 21, clusterRadiusKm: 1,
    nearestPlace: null, matchedTextClues: [], corroborationNotes: [],
  };
}

describe('Multi-evidence geographic leads', () => {
  it('puts a readable toponym ahead of an unsupported diffuse visual estimate, without fabricating confidence', () => {
    const visual = lead('visual-belgium', 'visual_model', 0.116);
    const ocr = lead('ocr-barcelos', 'ocr_gazetteer', 0);
    const ranked = rankHypothesesByEvidence([visual, ocr]);
    expect(ranked.map((h) => h.id)).toEqual(['ocr-barcelos', 'visual-belgium']);
    expect(ranked.map((h) => h.relativeAffinity)).toEqual([0, 0.116]);
    expect(ranked.map((h) => h.rank)).toEqual([1, 2]);
  });

  it('places direct EXIF GPS and explicit human verification above OCR-only leads', () => {
    const ocr = lead('ocr', 'ocr_gazetteer', 0);
    const gps = lead('gps', 'exif_gps', 1);
    const verified = { ...lead('verified', 'visual_model', 0.01), verifiedByInvestigator: true };
    expect(rankHypothesesByEvidence([ocr, verified, gps]).map((h) => h.id))
      .toEqual(['gps', 'verified', 'ocr']);
  });

  it('preserves corroborated visual clues above an unverified isolated OCR city name', () => {
    const visual = { ...lead('visual', 'visual_model', 0.21), matchedTextClues: ['Barcelos (PT)'] };
    const ocr = lead('ocr', 'ocr_gazetteer', 0);
    expect(rankHypothesesByEvidence([ocr, visual]).map((h) => h.id))
      .toEqual(['visual', 'ocr']);
  });

  it('adds distant OCR names as separate hypotheses and never converts motif mentions into GPS', () => {
    const visual = lead('hyp-vis-1', 'visual_model', 0.116);
    const ambiguity = assessAmbiguity({
      hasGps: false, top1Mass: 0.116, top1PeakLogit: 10.63,
      top1ToTop2Ratio: 1.56, spatialSpreadKm: 1900, distinctContinentsCount: 1,
    });
    const ocr: OcrExtractionResult = {
      status: 'complete', progress: 100, language: 'eng+por', rawText: 'Barcelos',
      tokens: ['Barcelos'],
      matchedGazetteerPlaces: [{token: 'barcelos', name: 'Barcelos', countryCode: 'PT',
        countryName: 'Portugal', lat: 41.5324, lon: -8.6181, population: 120000}],
    };
    const result = reevaluateHypothesesEvidence([visual], ambiguity, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr,
    });
    expect(result.hypotheses[0].nearestPlace?.name).toBe('Barcelos');
    expect(result.hypotheses[0].source).toBe('ocr_gazetteer');
    expect(result.hypotheses[0].relativeAffinity).toBe(0);
    expect(result.ambiguity.classification).not.toBe('gps_metadata');
    expect(result.ambiguity.isAmbiguous).toBe(true);
    const reset = reevaluateHypothesesEvidence(result.hypotheses, result.ambiguity, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr: { ...ocr, matchedGazetteerPlaces: [], tokens: [], rawText: '' },
    });
    expect(reset.hypotheses.map((h) => h.id)).toEqual(['hyp-vis-1']);
  });
});
