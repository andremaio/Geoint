import { describe, expect, it } from 'vitest';
import { selectDistinctiveCulturalClues, selectCulturalCluesAcrossRegions } from '../src/engine/culturalEvidence';
import { CULTURAL_CROP_REGIONS } from '../src/engine/culturalRegions';
import { isDistinctiveOcrToponym } from '../src/engine/gazetteer';
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
  it('keeps uncorroborated OCR text separate from visual estimates without fabricating confidence', () => {
    const visual = lead('visual-belgium', 'visual_model', 0.116);
    const ocr = lead('ocr-barcelos', 'ocr_gazetteer', 0);
    const ranked = rankHypothesesByEvidence([visual, ocr]);
    expect(ranked.map((h) => h.id)).toEqual(['visual-belgium', 'ocr-barcelos']);
    expect(ranked.map((h) => h.relativeAffinity)).toEqual([0.116, 0]);
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
    expect(result.hypotheses[1].nearestPlace?.name).toBe('Barcelos');
    expect(result.hypotheses[1].source).toBe('ocr_gazetteer');
    expect(result.hypotheses[1].relativeAffinity).toBe(0);
    expect(result.ambiguity.classification).not.toBe('gps_metadata');
    expect(result.ambiguity.isAmbiguous).toBe(true);
    const reset = reevaluateHypothesesEvidence(result.hypotheses, result.ambiguity, {
      metadata: { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 },
      ocr: { ...ocr, matchedGazetteerPlaces: [], tokens: [], rawText: '' },
    });
    expect(reset.hypotheses.map((h) => h.id)).toEqual(['hyp-vis-1']);
  });
});

describe('Cultural scene classification safety', () => {
  const clue = (id: string, score: number, countryCode?: string) => ({
    id, score, label: id, countryCode, association: 'Unverified visual association',
  });
  it('does not turn a generic scene into a geographic clue regardless of score', () => {
    expect(selectDistinctiveCulturalClues([
      clue('indoor', 0.482), clue('church', 0.22), clue('azulejos', 0.10, 'PT'),
    ])).toEqual([]);
  });
  it('allows a distinctive cultural motif only with a clear comparative margin', () => {
    const recognised = clue('barcelos-rooster', 0.45, 'PT');
    expect(selectDistinctiveCulturalClues([recognised, clue('rooster-general', 0.31)]))
      .toEqual([recognised]);
    expect(selectDistinctiveCulturalClues([recognised, clue('rooster-general', 0.40)]))
      .toEqual([]);
  });
  it('retains general rooster imagery only as unverified, unlocated context', () => {
    const genericRooster = clue('rooster-general', 0.55);
    expect(selectDistinctiveCulturalClues([genericRooster, clue('indoor', 0.15)]))
      .toEqual([genericRooster]);
    expect(genericRooster.countryCode).toBeUndefined();
  });
});

describe('OCR false-positive geolocation regression', () => {
  it('rejects short or generic single words without discarding genuine long toponyms', () => {
    for (const token of ['Sale', 'Salé', 'SALE', 'Market', 'Museum', 'Hotel', 'Plaza', 'Église']) {
      expect(isDistinctiveOcrToponym(token)).toBe(false);
    }
    for (const token of ['Barcelos', 'Arcueil', 'Katowice', 'Thimphu', 'New York']) {
      expect(isDistinctiveOcrToponym(token)).toBe(true);
    }
  });

  it('does not turn a saved Sale/Salé OCR hallucination into Moroccan or British pins', () => {
    const visual = lead('hyp-vis-1', 'visual_model', 0.116);
    const ambiguity = assessAmbiguity({
      hasGps: false, top1Mass: 0.116, top1PeakLogit: 10.63,
      top1ToTop2Ratio: 1.4, spatialSpreadKm: 1400, distinctContinentsCount: 1,
    });
    const metadata = { hasExif: false, hasGps: false, gps: null, rawTagsCount: 0 };
    const ocr = {
      status: 'complete' as const, progress: 100, language: 'eng+por',
      rawText: 'SALE', tokens: ['Sale'],
      matchedGazetteerPlaces: [
        { token: 'Sale', name: 'Salé', countryCode: 'MA', countryName: 'Morocco', lat: 34.0531, lon: -6.7985 },
        { token: 'Sale', name: 'Sale', countryCode: 'GB', countryName: 'United Kingdom', lat: 53.4252, lon: -2.3244 },
      ],
    };
    const prior = [...[visual], ...ocr.matchedGazetteerPlaces.map((m, i) => ({
      ...lead('hyp-ocr-' + (i + 1), 'ocr_gazetteer', 0),
      lat: m.lat, lon: m.lon,
    }))];
    const result = reevaluateHypothesesEvidence(prior, ambiguity, { metadata, ocr });
    expect(result.hypotheses.map((h) => h.id)).toEqual(['hyp-vis-1']);
    expect(result.ambiguity.classification).not.toBe('gps_metadata');
    expect(result.ambiguity.classification).not.toBe('evidence_corroborated');
  });
});

describe('Multi-region cultural detection', () => {
  const cue = (id: string, score: number) => ({
    id, score,
    label: id,
    countryCode: id === 'barcelos-rooster' ? 'PT' : undefined,
    associatedPlace: id === 'barcelos-rooster' ? 'Barcelos' : undefined,
    association: 'Not confirmed geolocation',
  });
  const frame = (regionId: string, scores: Array<[string, number]>) => ({
    regionId, scores: scores.map(([id, score]) => cue(id, score)),
  });

  it('detects a culturally distinctive rooster across overlapping views when full-frame Christmas lights dominate', () => {
    const result = selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .61], ['barcelos-rooster', .12], ['rooster-general', .10], ['indoor', .17]]),
      frame('middle', [['barcelos-rooster', .34], ['rooster-general', .33], ['christmas', .19], ['generic-square', .14]]),
      frame('right', [['barcelos-rooster', .42], ['rooster-general', .26], ['christmas', .20], ['generic-square', .12]]),
    ]);
    expect(result[0]?.id).toBe('barcelos-rooster');
    expect(result[0]?.associatedPlace).toBe('Barcelos');
    expect(result[0]?.detectionScope).toBe('regional');
    expect(result[0]?.supportingViews).toBe(2);
  });

  it('rejects a single isolated crop even if it suggests a distinctive place', () => {
    const result = selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .64], ['barcelos-rooster', .08]]),
      frame('middle', [['barcelos-rooster', .70], ['rooster-general', .12], ['christmas', .18]]),
      frame('right', [['christmas', .80], ['generic-square', .20]]),
    ]);
    expect(result).toEqual([]);
  });

  it('recognises a generic rooster without inventing a Barcelos connection', () => {
    const result = selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .54], ['rooster-general', .20], ['barcelos-rooster', .04]]),
      frame('middle', [['rooster-general', .60], ['barcelos-rooster', .04], ['indoor', .21], ['christmas', .15]]),
      frame('right', [['rooster-general', .51], ['barcelos-rooster', .09], ['christmas', .30], ['indoor', .10]]),
    ]);
    expect(result[0]?.id).toBe('rooster-general');
    expect(result[0]?.associatedPlace).toBeUndefined();
  });

  it('fast-paths a clear single landmark and does not force a label on generic night scenery', () => {
    const landmark = selectCulturalCluesAcrossRegions([
      frame('full', [['barcelos-rooster', .948], ['rooster-general', .018], ['christmas', .034]]),
    ]);
    expect(landmark[0]?.id).toBe('barcelos-rooster');
    expect(landmark[0]?.detectionScope).toBe('whole');
    expect(selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .63], ['indoor', .19], ['generic-square', .18]]),
      frame('middle', [['indoor', .47], ['generic-square', .32], ['christmas', .21]]),
      frame('right', [['christmas', .58], ['generic-square', .37], ['barcelos-rooster', .05]]),
    ])).toEqual([]);
  });

  it('recovers a small rooster from one exceptionally clear lower-right crop while rejecting Christmas-only surroundings', () => {
    const result = selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .9784], ['barcelos-rooster', .0004], ['generic-square', .0212]]),
      frame('top-right', [['christmas', .8732], ['barcelos-rooster', .006], ['rooster-general', .0048]]),
      frame('lower-right', [
        ['rooster-general', .5063], ['barcelos-rooster', .3931],
        ['generic-square', .0607], ['christmas', .0315],
      ]),
    ]);
    expect(result[0]?.id).toBe('barcelos-rooster');
    expect(result[0]?.associatedPlace).toBe('Barcelos');
    expect(result[0]?.detectionScope).toBe('regional');
    expect(result[0]?.supportingViews).toBe(1);
  });

  it('does not infer Barcelos from a strong but generic rooster statue', () => {
    const result = selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .70], ['rooster-general', .01]]),
      frame('lower-right', [
        ['rooster-general', .85], ['barcelos-rooster', .06], ['generic-square', .07],
      ]),
    ]);
    expect(result[0]?.id).toBe('rooster-general');
    expect(result[0]?.countryCode).toBeUndefined();
  });

  it('refuses strong non-object Christmas labels when there is no rooster', () => {
    expect(selectCulturalCluesAcrossRegions([
      frame('full', [['christmas', .978], ['generic-square', .01]]),
      frame('lower-right', [['christmas', .90], ['rooster-general', .0197], ['barcelos-rooster', .006]]),
      frame('top-center', [['christmas', .84], ['generic-square', .16]]),
    ])).toEqual([]);
  });

  it('keeps all crop windows normalized and bounded so they cannot access pixels out of frame', () => {
    expect(CULTURAL_CROP_REGIONS.length).toBeGreaterThanOrEqual(3);
    for (const region of CULTURAL_CROP_REGIONS) {
      expect(region.left).toBeGreaterThanOrEqual(0);
      expect(region.top).toBeGreaterThanOrEqual(0);
      expect(region.width).toBeGreaterThan(0);
      expect(region.height).toBeGreaterThan(0);
      expect(region.left + region.width).toBeLessThanOrEqual(1);
      expect(region.top + region.height).toBeLessThanOrEqual(1);
    }
  });
});
