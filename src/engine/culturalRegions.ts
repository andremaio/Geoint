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
  { id: 'middle', left: 0.18, top: 0.07, width: 0.64, height: 0.86 },
  { id: 'right', left: 0.37, top: 0.07, width: 0.63, height: 0.86 },
  { id: 'left', left: 0, top: 0.07, width: 0.63, height: 0.86 },
  { id: 'lower', left: 0.18, top: 0.24, width: 0.64, height: 0.76 },
];
