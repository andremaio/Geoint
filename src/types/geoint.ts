export type Language = 'en' | 'pt-PT';

export type ModelDtype = 'q4' | 'bnb4' | 'int8';

export type PredictionConfidenceClass =
  | 'gps_metadata'
  | 'evidence_corroborated'
  | 'visual_estimate'
  | 'inconclusive';

export interface ValidationResult {
  valid: boolean;
  mimeType: string;
  detectedSignature: string;
  fileName: string;
  fileSizeBytes: number;
  width: number;
  height: number;
  aspectRatio: number;
  sha256: string;
  warnings: string[];
  error?: string;
}

export interface ExifMetadataSummary {
  hasExif: boolean;
  hasGps: boolean;
  gps: {
    lat: number;
    lon: number;
    altitudeMeters?: number;
    imgDirectionDeg?: number;
    timestampIso?: string;
  } | null;
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  focalLengthMm?: number;
  focalLength35mm?: number;
  fNumber?: number;
  exposureTimeSec?: number;
  iso?: number;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  software?: string;
  imageWidth?: number;
  imageHeight?: number;
  orientation?: number;
  colorSpace?: string;
  rawTagsCount: number;
}

export interface GazetteerPlace {
  name: string;
  countryCode: string;
  countryName: string;
  region: string;
  lat: number;
  lon: number;
  population: number;
  distanceKm: number;
  bearingDeg: number;
  compass: string;
}

export interface SolarAnalysis {
  timestampIso: string;
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  expectedShadowDirectionDeg: number;
  observedShadowAzimuthDeg?: number;
  angularDeltaDeg?: number;
  isDaylight: boolean;
  consistencyLabel: 'consistent' | 'plausible' | 'divergent' | 'insufficient_data';
}

export interface GeoHypothesis {
  id: string;
  rank: number;
  source: 'exif_gps' | 'visual_model' | 'ocr_gazetteer' | 'manual_override';
  lat: number;
  lon: number;
  /** Raw uncalibrated normalized model share within top candidates (NOT a statistical probability of truth) */
  relativeAffinity: number;
  peakLogit: number;
  supportPointsCount: number;
  clusterRadiusKm: number;
  nearestPlace: GazetteerPlace | null;
  matchedTextClues: string[];
  solarCheck?: SolarAnalysis;
  corroborationNotes: string[];
  verifiedByInvestigator?: boolean;
}

export interface AmbiguityAssessment {
  classification: PredictionConfidenceClass;
  isAmbiguous: boolean;
  isInconclusive: boolean;
  reasons: string[];
  metrics: {
    top1Mass: number;
    top1PeakLogit: number;
    top1ToTop2Ratio: number;
    spatialSpreadKm: number;
    distinctContinentsCount: number;
  };
}

/** Exploratory scene-symbol label; association is cultural, not geolocation proof. */
export interface CulturalClue {
  id: string;
  /** Whether CLIP evaluated the entire frame or individual cropped views. */
  detectionScope?: 'whole' | 'regional';
  /** Number of crops supporting a label; not independent geolocation evidence. */
  supportingViews?: number;
  /** Cultural association only: NEVER a photo-capture location or GPS fix. */
  associatedPlace?: string;
  label: string;
  association: string;
  score: number;
  countryCode?: string;
}

export interface OcrExtractionResult {
  status: 'idle' | 'downloading' | 'running' | 'complete' | 'cancelled' | 'error';
  progress: number;
  language: string;
  rawText: string;
  tokens: string[];
  matchedGazetteerPlaces: Array<{
    token: string;
    name: string;
    countryCode: string;
    countryName: string;
    region?: string;
    population?: number;
    lat: number;
    lon: number;
  }>;
  error?: string;
}

export interface WikimediaReferencePhoto {
  pageId: number;
  title: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  thumbUrl: string;
  pageUrl: string;
  license: string;
  artist: string;
}

export interface TriangulationRay {
  id: string;
  originLat: number;
  originLon: number;
  bearingDeg: number;
  lengthKm: number;
  label: string;
}

export interface MeasurementLine {
  id: string;
  points: Array<[number, number]>; // [lon, lat]
  totalKm: number;
  bearingDeg: number;
}

export interface InvestigationCase {
  caseId: string;
  createdAtIso: string;
  updatedAtIso: string;
  imageValidation: ValidationResult;
  metadata: ExifMetadataSummary;
  modelInfo: {
    modelId: string;
    dtype: ModelDtype;
    executionProvider: 'webgpu' | 'wasm' | 'none';
    gallerySize: number;
    inferenceDurationMs: number;
    locationCacheHit: boolean;
  };
  hypotheses: GeoHypothesis[];
  selectedHypothesisId: string | null;
  ambiguity: AmbiguityAssessment;
  ocr: OcrExtractionResult;
  culturalClues?: CulturalClue[];
  observedShadowAzimuthDeg?: number;
  manualTimestampIso?: string;
  triangulationRays: TriangulationRay[];
  measurements: MeasurementLine[];
  investigatorNotes: string;
  manualCorrection?: {
    lat: number;
    lon: number;
    label: string;
    rationale: string;
  };
}

export interface RuntimeCapabilities {
  webgpu: boolean;
  webgl: boolean;
  wasmSimd: boolean;
  indexedDb: boolean;
  webWorkers: boolean;
  reducedMotion: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
}

export interface ModelLoadProgress {
  stage: 'idle' | 'downloading_model' | 'building_location_index' | 'running_vision' | 'clustering' | 'ready' | 'cancelled' | 'error';
  percent: number;
  downloadedBytes?: number;
  totalBytes?: number;
  activeFile?: string;
  detail?: string;
  error?: string;
}
