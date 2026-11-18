import type { CulturalClue } from '../types/geoint';

/**
 * Contrastive CLIP outputs compare only the supplied label descriptions.
 * They are NOT probabilities or source evidence. Reject generic winning
 * descriptions and weak margins instead of displaying a forced cultural ID.
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
