/**
 * Device-local multi-region inspection plan (normalized coordinates).
 * Larger overlapping square-ish windows keep salient objects visible while
 * retaining enough scene context for CLIP classification.
 */
export interface CulturalCropRegion {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export const CULTURAL_CROP_REGIONS: readonly CulturalCropRegion[] = [
  // Overlapping object-scale windows; 48% of image width instead of 64%.
  // Top/bottom pairs allow the same object to appear in two views without
  // relying on a single accidental high-scoring crop.
  { id: 'top-right', left: 0.52, top: 0.08, width: 0.48, height: 0.65 },
  { id: 'lower-right', left: 0.52, top: 0.33, width: 0.48, height: 0.65 },
  { id: 'top-center', left: 0.26, top: 0.08, width: 0.48, height: 0.65 },
  { id: 'lower-center', left: 0.26, top: 0.33, width: 0.48, height: 0.65 },
  { id: 'top-left', left: 0, top: 0.08, width: 0.48, height: 0.65 },
  { id: 'lower-left', left: 0, top: 0.33, width: 0.48, height: 0.65 },
];
