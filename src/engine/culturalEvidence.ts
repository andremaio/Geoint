import type { CulturalClue } from '../types/geoint';

/**
 * CLIP scores are relative to the supplied descriptions. They must never be
 * treated as calibrated probabilities or as a verified location.
 */
export function selectDistinctiveCulturalClues(scores: CulturalClue[]): CulturalClue[] {
  const ranked = [...scores]
    .filter((s) => Number.isFinite(s.score) && s.score >= 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 0.28 || best.score - (runnerUp?.score || 0) < 0.10) {
    return [];
  }
  const distinctive = Boolean(best.countryCode) || best.id === 'rooster-general';
  return distinctive ? [best] : [];
}

export interface CulturalRegionObservation {
  regionId: string;
  scores: CulturalClue[];
}

/**
 * A landmark may occupy only part of a scene. Compare several independently
 * cropped views, rather than letting the full-frame Christmas lights dominate.
 * Agreement between overlapping crops is ONLY a model-consistency check;
 * it is not independent geographic corroboration.
 */
export function selectCulturalCluesAcrossRegions(
  observations: CulturalRegionObservation[]
): CulturalClue[] {
  if (!observations.length) return [];

  const full = observations.find((o) => o.regionId === 'full');
  const fullCue = full ? selectDistinctiveCulturalClues(full.scores)[0] : undefined;
  if (fullCue?.countryCode && fullCue.score >= 0.75) {
    return [{ ...fullCue, detectionScope: 'whole', supportingViews: 1 }];
  }

  const votes = new Map<string, { clue: CulturalClue; views: Set<string>; best: number }>();
  for (const observation of observations.filter((o) => o.regionId !== 'full')) {
    const scores = observation.scores
      .filter((cue) => Number.isFinite(cue.score) && cue.score >= 0)
      .sort((a, b) => b.score - a.score);
    const galo = scores.find((cue) => cue.id === 'barcelos-rooster');
    const rooster = scores.find((cue) => cue.id === 'rooster-general');
    const competitors = scores.filter((cue) =>
      cue.id !== 'barcelos-rooster' && cue.id !== 'rooster-general'
    );
    const otherScore = competitors[0]?.score || 0;
    const familyScore = (galo?.score || 0) + (rooster?.score || 0);
    let selected: CulturalClue | undefined;

    // 'Barcelos rooster' and 'rooster sculpture' describe the same object.
    // Comparing them as if they were competing objects produced false negatives.
    if (familyScore >= 0.38 && familyScore >= otherScore + 0.12) {
      const strongStyle = Boolean(galo &&
        galo.score >= 0.20 &&
        galo.score >= (rooster?.score || 0) * 0.9);
      selected = strongStyle ? galo : rooster;
    } else {
      selected = selectDistinctiveCulturalClues(scores)[0];
    }
    if (!selected) continue;

    const previous = votes.get(selected.id);
    if (!previous) {
      votes.set(selected.id, {
        clue: selected,
        views: new Set([observation.regionId]),
        best: selected.score,
      });
    } else {
      previous.views.add(observation.regionId);
      if (selected.score > previous.best) {
        previous.clue = selected;
        previous.best = selected.score;
      }
    }
  }

  const candidates = [...votes.values()].filter((v) => v.views.size >= 2);
  candidates.sort((a, b) => b.views.size - a.views.size || b.best - a.best);
  const chosen = candidates[0];
  if (chosen) {
    return [{
      ...chosen.clue,
      detectionScope: 'regional',
      supportingViews: chosen.views.size,
    }];
  }

  // A single isolated crop is insufficient: do not force a cultural ID.
  // The whole-frame result may still provide a high-confidence generic
  // object category, but never a location on its own.
  if (fullCue && fullCue.id === 'rooster-general' && fullCue.score >= 0.60) {
    return [{ ...fullCue, detectionScope: 'whole', supportingViews: 1 }];
  }
  return [];
}
