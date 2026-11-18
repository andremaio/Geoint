import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Sparkles,
  Download,
  X,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileText,
  Trash2,
  Camera,
  ScanText,
  Sun,
  Compass,
  Image as ImageIcon,
  ClipboardEdit,
  Save,
  Map as MapIcon,
  Info,
  ExternalLink,
} from 'lucide-react';
import {
  assessAmbiguity,
  buildHypothesesFromResults,
  reevaluateHypothesesEvidence,
} from '../engine/candidates';
import { formatErrorDiagnostic } from '../engine/diagnostics';
import { findNearestPlace } from '../engine/gazetteer';
import { formatCoordPair, intersectBearingRays } from '../engine/geoMath';
import {
  cancelVisualGeolocation,
  checkVisualModelCached,
  runVisualGeolocation,
} from '../engine/inferenceClient';
import { validateAndIngestImage } from '../engine/ingest';
import { extractImageMetadata } from '../engine/metadata';
import {
  clearAllLocalSessions,
  createThumbnailDataUrl,
  deleteLocalSession,
  listLocalSessions,
  saveLocalSession,
  type StoredCaseRecord,
} from '../engine/sessions';
import { analyzeSolarConsistency } from '../engine/solar';
import { searchNearbyOpenReferencePhotos } from '../engine/wikimedia';
import { TRANSLATIONS } from '../i18n/translations';
import type {
  GeoHypothesis,
  InvestigationCase,
  Language,
  ModelDtype,
  ModelLoadProgress,
  RuntimeCapabilities,
  WikimediaReferencePhoto,
} from '../types/geoint';
import { ImageEvidenceViewer } from './ImageEvidenceViewer';
import {
  MapWorkspace,
  type MapInteractionMode,
  type MapWorkspaceHandle,
} from './MapWorkspace';

interface AnalysisWorkspaceProps {
  lang: Language;
  capabilities: RuntimeCapabilities;
}

type EvidenceTab = 'metadata' | 'ocr' | 'solar' | 'triangulation' | 'references' | 'notes';
type MobilePane = 'leads' | 'map' | 'evidence';

function formatBytesMb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AnalysisWorkspace: React.FC<AnalysisWorkspaceProps> = ({
  lang,
  capabilities,
}) => {
  const t = TRANSLATIONS[lang];
  const pt = lang === 'pt-PT';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapHandleRef = useRef<MapWorkspaceHandle>(null);

  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 920
  );
  const [mobilePane, setMobilePane] = useState<MobilePane>('leads');

  const [dragActive, setDragActive] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<StoredCaseRecord[]>([]);

  const [activeCase, setActiveCase] = useState<InvestigationCase | null>(null);
  const [activeBuffer, setActiveBuffer] = useState<ArrayBuffer | null>(null);
  const [activeImageUrl, setActiveImageUrl] = useState<string>('');

  const [selectedDtype, setSelectedDtype] = useState<ModelDtype>('q4');
  const [modelCached, setModelCached] = useState(false);
  const [visualStatus, setVisualStatus] = useState<
    'idle' | 'awaiting_consent' | 'running' | 'complete' | 'skipped' | 'cancelled' | 'error'
  >('idle');
  const [modelProgress, setModelProgress] = useState<ModelLoadProgress>({
    stage: 'idle',
    percent: 0,
  });
  const [visualError, setVisualError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<EvidenceTab>('metadata');
  const [mapMode, setMapMode] = useState<MapInteractionMode>('inspect');

  const [ocrLang, setOcrLang] = useState('eng+por');
  const ocrGenerationRef = useRef(0);
  const caseGenerationRef = useRef(0);
  const [culturalStatus, setCulturalStatus] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
  const [culturalProgress, setCulturalProgress] = useState(0);
  const [culturalError, setCulturalError] = useState<string | null>(null);
  const [wikimediaRefs, setWikimediaRefs] = useState<WikimediaReferencePhoto[]>([]);
  const [wikimediaLoading, setWikimediaLoading] = useState(false);
  const [wikimediaError, setWikimediaError] = useState<string | null>(null);
  const [sessionSavedFlash, setSessionSavedFlash] = useState(false);

  // Track responsive viewport breakpoint cleanly
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 920px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Load recent local sessions & clean up object URL on unmount
  useEffect(() => {
    listLocalSessions().then(setRecentSessions).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (activeImageUrl && activeImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(activeImageUrl);
      }
    };
  }, [activeImageUrl]);

  useEffect(() => {
    checkVisualModelCached(selectedDtype).then(setModelCached).catch(() => setModelCached(false));
  }, [selectedDtype]);


  // OCR is independent from the visual model and never uploads the photograph.
  // Guard all callbacks against a different photograph replacing this case.
  const runOcrForCase = async (
    targetCase: InvestigationCase,
    buffer: ArrayBuffer,
    language: string
  ) => {
    const generation = ++ocrGenerationRef.current;
    const { cancelLocalOcr, runLocalOcr } = await import('../engine/ocr');
    await cancelLocalOcr();
    if (generation !== ocrGenerationRef.current) return null;

    setActiveCase((prev) =>
      prev?.caseId === targetCase.caseId
        ? { ...prev, ocr: { ...prev.ocr, status: 'downloading', progress: 5, language } }
        : prev
    );
    const result = await runLocalOcr(
      new Blob([buffer], { type: targetCase.imageValidation.mimeType }),
      language,
      (progress, stage) => {
        if (generation !== ocrGenerationRef.current) return;
        setActiveCase((prev) =>
          prev?.caseId === targetCase.caseId
            ? { ...prev, ocr: { ...prev.ocr, status: stage, progress, language } }
            : prev
        );
      }
    );
    if (generation !== ocrGenerationRef.current) return null;

    setActiveCase((prev) => {
      if (!prev || prev.caseId !== targetCase.caseId) return prev;
      const { hypotheses, ambiguity } = reevaluateHypothesesEvidence(
        prev.hypotheses, prev.ambiguity,
        {
          metadata: prev.metadata,
          ocr: result,
          observedShadowAzimuthDeg: prev.observedShadowAzimuthDeg,
          manualTimestampIso: prev.manualTimestampIso,
        }
      );
      return {
        ...prev, ocr: result, hypotheses, ambiguity, updatedAtIso: new Date().toISOString(),
        selectedHypothesisId: hypotheses.some((h) => h.id === prev.selectedHypothesisId)
          ? prev.selectedHypothesisId : hypotheses[0]?.id || null,
      };
    });
    return result;
  };

  const handleCulturalClues = async () => {
    if (!activeCase || culturalStatus === 'running') return;
    const id = activeCase.caseId;
    const generation = caseGenerationRef.current;
    setCulturalStatus('running');
    setCulturalProgress(0);
    setCulturalError(null);
    try {
      const { findCulturalClues } = await import('../engine/culturalClient');
      const buffer = activeBuffer ?? await fetch(activeImageUrl).then((r) => r.arrayBuffer());
      if (!buffer) throw new Error('Original image buffer unavailable');
      if (generation !== caseGenerationRef.current) return;
      const clues = await findCulturalClues(
        buffer, activeCase.imageValidation.mimeType,
        (percent) => { if (generation === caseGenerationRef.current) setCulturalProgress(percent); }
      );
      if (generation !== caseGenerationRef.current) return;
      setActiveCase((prev) =>
        prev?.caseId === id
          ? { ...prev, culturalClues: clues, updatedAtIso: new Date().toISOString() }
          : prev
      );
      setCulturalStatus('complete');
    } catch (error) {
      if (generation !== caseGenerationRef.current) return;
      setCulturalStatus('error');
      setCulturalError(error instanceof Error ? error.message : String(error));
    }
  };

  const executeVisualModel = async (
    targetCase: InvestigationCase,
    buffer: ArrayBuffer,
    dtype: ModelDtype
  ) => {
    setVisualStatus('running');
    setVisualError(null);
    setModelProgress({
      stage: 'downloading_model',
      percent: 2,
      detail: t.workspace.downloadingModel,
    });

    try {
      const inferOut = await runVisualGeolocation({
        imageBuffer: buffer,
        mimeType: targetCase.imageValidation.mimeType,
        dtype,
        onProgress: (prog) => setModelProgress(prog),
      });

      const { hypotheses, ambiguity } = await buildHypothesesFromResults({
        clusters: inferOut.clusters,
        spatialSpreadKm: inferOut.spatialSpreadKm,
        distinctContinentsCount: inferOut.distinctContinentsCount,
        metadata: targetCase.metadata,
        ocr: targetCase.ocr,
        observedShadowAzimuthDeg: targetCase.observedShadowAzimuthDeg,
        manualTimestampIso: targetCase.manualTimestampIso,
      });

      setActiveCase((prev) => {
        if (!prev || prev.caseId !== targetCase.caseId) return prev;
        const preservedManual = prev.hypotheses.filter((h) => h.source === 'manual_override');
        const merged = [...hypotheses, ...preservedManual].map((h, i) => ({
          ...h,
          rank: i + 1,
        }));
        // The OCR may complete while the heavy GeoCLIP worker is still running.
        // Merge against the most recent case state, never a stale upload snapshot.
        const evidence = reevaluateHypothesesEvidence(merged, ambiguity, {
          metadata: prev.metadata,
          ocr: prev.ocr,
          observedShadowAzimuthDeg: prev.observedShadowAzimuthDeg,
          manualTimestampIso: prev.manualTimestampIso,
        });
        return {
          ...prev,
          updatedAtIso: new Date().toISOString(),
          modelInfo: {
            modelId: 'Xenova/geoclip-large-patch14',
            dtype,
            executionProvider: inferOut.executionProvider,
            gallerySize: inferOut.gallerySize,
            inferenceDurationMs: inferOut.inferenceDurationMs,
            locationCacheHit: inferOut.locationCacheHit,
          },
          hypotheses: evidence.hypotheses,
          selectedHypothesisId: evidence.hypotheses[0]?.id || null,
          ambiguity: evidence.ambiguity,
        };
      });
      setVisualStatus('complete');
      setModelCached(true);
    } catch (err) {
      const diag = formatErrorDiagnostic(err);
      if (diag.code === 'ABORTED') {
        setVisualStatus('cancelled');
        setModelProgress({ stage: 'cancelled', percent: 0 });
      } else {
        setVisualStatus('error');
        setVisualError(diag.message);
        setModelProgress({ stage: 'error', percent: 0, error: diag.message });
      }
    }
  };

  const handleIngestFile = async (file: File) => {
    const uploadGeneration = ++caseGenerationRef.current;
    setCulturalStatus('idle');
    setCulturalProgress(0);
    setCulturalError(null);
    void import('../engine/culturalClient').then((m) => m.cancelCulturalClueAnalysis());
    setIngestError(null);
    setVisualError(null);
    setWikimediaRefs([]);
    setWikimediaError(null);
    cancelVisualGeolocation();

    const { validation, buffer } = await validateAndIngestImage(file);
    if (!validation.valid) {
      setIngestError(`${t.workspace.errorInvalidFile} (${validation.error || validation.detectedSignature})`);
      return;
    }

    if (activeImageUrl && activeImageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(activeImageUrl);
    }
    const nextUrl = URL.createObjectURL(new Blob([buffer], { type: validation.mimeType }));
    setActiveImageUrl(nextUrl);
    setActiveBuffer(buffer);

    const metadata = await extractImageMetadata(buffer);
    const nowIso = new Date().toISOString();
    const caseId = `CNX-${nowIso.slice(0, 10).replace(/-/g, '')}-${validation.sha256.slice(0, 6).toUpperCase()}`;

    // Pre-populate immediate EXIF GPS hypothesis if present in file
    const initialHypotheses: GeoHypothesis[] = [];
    if (metadata.hasGps && metadata.gps) {
      const nearest = await findNearestPlace(metadata.gps.lat, metadata.gps.lon);
      const solarCheck = analyzeSolarConsistency({
        lat: metadata.gps.lat,
        lon: metadata.gps.lon,
        timestampIso: metadata.dateTimeOriginal || metadata.gps.timestampIso,
      });
      initialHypotheses.push({
        id: 'hyp-exif-gps',
        rank: 1,
        source: 'exif_gps',
        lat: metadata.gps.lat,
        lon: metadata.gps.lon,
        relativeAffinity: 1,
        peakLogit: 0,
        supportPointsCount: 1,
        clusterRadiusKm: 0.1,
        nearestPlace: nearest,
        matchedTextClues: [],
        solarCheck,
        corroborationNotes: ['Extracted directly from image EXIF GPS metadata.'],
      });
    }

    const initialAmbiguity = assessAmbiguity({
      hasGps: metadata.hasGps,
      top1Mass: 0,
      top1PeakLogit: 0,
      top1ToTop2Ratio: 0,
      spatialSpreadKm: 0,
      distinctContinentsCount: 0,
      hasVisualClusters: false,
    });

    const newCase: InvestigationCase = {
      caseId,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      imageValidation: validation,
      metadata,
      modelInfo: {
        modelId: 'Xenova/geoclip-large-patch14',
        dtype: selectedDtype,
        executionProvider: 'none',
        gallerySize: 100000,
        inferenceDurationMs: 0,
        locationCacheHit: false,
      },
      hypotheses: initialHypotheses,
      selectedHypothesisId: initialHypotheses[0]?.id || null,
      ambiguity: initialAmbiguity,
      ocr: {
        status: 'idle',
        progress: 0,
        language: ocrLang,
        rawText: '',
        tokens: [],
        matchedGazetteerPlaces: [],
      },
      triangulationRays: [],
      measurements: [],
      investigatorNotes: '',
    };

    setActiveCase(newCase);
    setActiveTab('metadata');
    setMobilePane('leads');
    setVisualStatus('awaiting_consent');

    // Start local OCR automatically on every uploaded photo. This is performed
    // before the cached GeoCLIP path, avoiding simultaneous model allocations
    // on memory-constrained phones.
    const textEvidence = await runOcrForCase(newCase, buffer, ocrLang);
    if (caseGenerationRef.current !== uploadGeneration) return;
    const cached = await checkVisualModelCached(selectedDtype);
    setModelCached(cached);
    if (cached) {
      await executeVisualModel(
        { ...newCase, ocr: textEvidence || newCase.ocr },
        buffer,
        selectedDtype
      );
    }
  };

  const handleLoadSample = async () => {
    try {
      const res = await fetch('/samples/torre-de-belem.jpg');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const sampleFile = new File([blob], 'torre-de-belem-sample.jpg', { type: 'image/jpeg' });
      await handleIngestFile(sampleFile);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Failed to load sample image');
    }
  };

  const handleOpenStoredSession = (record: StoredCaseRecord) => {
    caseGenerationRef.current += 1;
    ocrGenerationRef.current += 1;
    void import('../engine/ocr').then((m) => m.cancelLocalOcr());
    void import('../engine/culturalClient').then((m) => m.cancelCulturalClueAnalysis());
    setCulturalStatus(record.caseData.culturalClues ? 'complete' : 'idle');
    cancelVisualGeolocation();
    setActiveCase(record.caseData);
    setActiveBuffer(null);
    setActiveImageUrl(record.thumbnailDataUrl);
    setVisualStatus(record.caseData.modelInfo.executionProvider !== 'none' ? 'complete' : 'skipped');
    setWikimediaRefs([]);
  };

  const handleResetWorkspace = () => {
    caseGenerationRef.current += 1;
    ocrGenerationRef.current += 1;
    void import('../engine/culturalClient').then((m) => m.cancelCulturalClueAnalysis());
    setCulturalStatus('idle');
    cancelVisualGeolocation();
    if (activeCase?.ocr.status === 'downloading' || activeCase?.ocr.status === 'running') {
      void import('../engine/ocr').then((m) => m.cancelLocalOcr()).catch(() => {});
    }
    if (activeImageUrl && activeImageUrl.startsWith('blob:')) {
      URL.revokeObjectURL(activeImageUrl);
    }
    setActiveCase(null);
    setActiveBuffer(null);
    setActiveImageUrl('');
    setVisualStatus('idle');
    setVisualError(null);
    setWikimediaRefs([]);
    listLocalSessions().then(setRecentSessions).catch(() => {});
  };

  const handleVerifyCandidate = (id: string) => {
    setActiveCase((prev) => {
      if (!prev) return prev;
      const toggled = prev.hypotheses.map((h) =>
        h.id === id ? { ...h, verifiedByInvestigator: !h.verifiedByInvestigator } : h
      );
      const { hypotheses, ambiguity } = reevaluateHypothesesEvidence(toggled, prev.ambiguity, {
        metadata: prev.metadata,
        ocr: prev.ocr,
        observedShadowAzimuthDeg: prev.observedShadowAzimuthDeg,
        manualTimestampIso: prev.manualTimestampIso,
      });
      return { ...prev, updatedAtIso: new Date().toISOString(), hypotheses, ambiguity };
    });
  };

  const handleSetManualPin = async (lat: number, lon: number) => {
    const nearest = await findNearestPlace(lat, lon);
    setActiveCase((prev) => {
      if (!prev) return prev;
      const filtered = prev.hypotheses.filter((h) => h.source !== 'manual_override');
      const solarCheck = analyzeSolarConsistency({
        lat,
        lon,
        timestampIso: prev.manualTimestampIso || prev.metadata.dateTimeOriginal || prev.metadata.gps?.timestampIso,
        observedShadowAzimuthDeg: prev.observedShadowAzimuthDeg,
      });
      const manualHyp: GeoHypothesis = {
        id: 'hyp-manual-override',
        rank: filtered.length + 1,
        source: 'manual_override',
        lat,
        lon,
        relativeAffinity: 0,
        peakLogit: 0,
        supportPointsCount: 1,
        clusterRadiusKm: 0.05,
        nearestPlace: nearest,
        matchedTextClues: [],
        solarCheck,
        corroborationNotes: ['Investigator manual cartographic verification pin.'],
        verifiedByInvestigator: true,
      };
      const merged = [manualHyp, ...filtered].map((h, i) => ({ ...h, rank: i + 1 }));
      const { hypotheses, ambiguity } = reevaluateHypothesesEvidence(merged, prev.ambiguity, {
        metadata: prev.metadata,
        ocr: prev.ocr,
        observedShadowAzimuthDeg: prev.observedShadowAzimuthDeg,
        manualTimestampIso: prev.manualTimestampIso,
      });
      return {
        ...prev,
        updatedAtIso: new Date().toISOString(),
        hypotheses,
        selectedHypothesisId: manualHyp.id,
        manualCorrection: {
          lat,
          lon,
          label: nearest ? `${nearest.name}, ${nearest.countryName}` : formatCoordPair(lat, lon),
          rationale: prev.manualCorrection?.rationale || 'Set via interactive map pin',
        },
        ambiguity,
      };
    });
  };

  const handleRunOcr = async () => {
    if (!activeCase) return;
    const buffer = activeBuffer ?? await fetch(activeImageUrl).then((r) => r.arrayBuffer());
      if (!buffer) throw new Error('Original image buffer unavailable');
    await runOcrForCase(activeCase, buffer, ocrLang);
  };

  const handleSolarChange = (nextShadowDeg?: number, nextIso?: string) => {
    setActiveCase((prev) => {
      if (!prev) return prev;
      const observedShadowAzimuthDeg =
        nextShadowDeg !== undefined ? nextShadowDeg : prev.observedShadowAzimuthDeg;
      const manualTimestampIso = nextIso !== undefined ? nextIso : prev.manualTimestampIso;
      const { hypotheses, ambiguity } = reevaluateHypothesesEvidence(prev.hypotheses, prev.ambiguity, {
        metadata: prev.metadata,
        ocr: prev.ocr,
        observedShadowAzimuthDeg,
        manualTimestampIso,
      });
      return {
        ...prev,
        updatedAtIso: new Date().toISOString(),
        observedShadowAzimuthDeg,
        manualTimestampIso,
        hypotheses,
        ambiguity,
      };
    });
  };

  const handleSaveSession = async () => {
    if (!activeCase) return;
    try {
      const thumbBlob = activeBuffer
        ? new Blob([activeBuffer], { type: activeCase.imageValidation.mimeType })
        : await fetch(activeImageUrl).then((r) => r.blob());
      const thumbDataUrl = await createThumbnailDataUrl(thumbBlob);
      await saveLocalSession({ caseData: activeCase, thumbnailDataUrl: thumbDataUrl });
      setRecentSessions(await listLocalSessions());
      setSessionSavedFlash(true);
      setTimeout(() => setSessionSavedFlash(false), 2000);
    } catch {
      // ignore IndexedDB failures
    }
  };

  const handleExportPdf = async () => {
    if (!activeCase) return;
    let thumbUrl = '';
    try {
      const thumbBlob = activeBuffer
        ? new Blob([activeBuffer], { type: activeCase.imageValidation.mimeType })
        : await fetch(activeImageUrl).then((r) => r.blob());
      thumbUrl = await createThumbnailDataUrl(thumbBlob, 480);
    } catch {
      thumbUrl = '';
    }
    const mapSnapshotDataUrl = mapHandleRef.current?.captureSnapshotDataUrl();
    const { generateInvestigationReportPdf } = await import('../engine/reportPdf');
    await generateInvestigationReportPdf({
      caseData: activeCase,
      imageDataUrl: thumbUrl || undefined,
      mapSnapshotDataUrl,
      lang,
    });
  };

  const handleWikimediaLookup = async () => {
    const selected = activeCase?.hypotheses.find((h) => h.id === activeCase.selectedHypothesisId);
    if (!selected) return;
    setWikimediaLoading(true);
    setWikimediaError(null);
    try {
      const items = await searchNearbyOpenReferencePhotos(selected.lat, selected.lon, 1500, 6);
      setWikimediaRefs(items);
    } catch (err) {
      setWikimediaError(err instanceof Error ? err.message : 'Wikimedia lookup failed');
    } finally {
      setWikimediaLoading(false);
    }
  };

  const triangulationIntersection = useMemo(() => {
    if (!activeCase || activeCase.triangulationRays.length < 2) return null;
    const rays = activeCase.triangulationRays;
    const r1 = rays[rays.length - 2];
    const r2 = rays[rays.length - 1];
    return intersectBearingRays(
      r1.originLat,
      r1.originLon,
      r1.bearingDeg,
      r2.originLat,
      r2.originLon,
      r2.bearingDeg
    );
  }, [activeCase]);

  const classificationBadge = (cls: InvestigationCase['ambiguity']['classification']) => {
    switch (cls) {
      case 'gps_metadata':
        return { className: 'gps', label: t.workspace.classificationGps, icon: CheckCircle2 };
      case 'evidence_corroborated':
        return { className: 'corroborated', label: t.workspace.classificationCorroborated, icon: Sparkles };
      case 'visual_estimate':
        return { className: 'visual', label: t.workspace.classificationVisual, icon: HelpCircle };
      case 'inconclusive':
        return { className: 'inconclusive', label: t.workspace.classificationInconclusive, icon: AlertTriangle };
    }
  };

  // ==================== STATE 0: UPLOAD STAGING ====================
  if (!activeCase) {
    return (
      <div
        className="workspace-root"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: '92px 20px 56px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 740, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            className="panel-surface"
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) handleIngestFile(dropped);
            }}
            style={{
              padding: 'clamp(28px, 5vw, 52px)',
              textAlign: 'center',
              borderStyle: 'dashed',
              borderWidth: 1.5,
              borderColor: dragActive ? 'var(--accent-cyan)' : 'var(--border-strong)',
              background: dragActive
                ? 'rgba(56, 189, 248, 0.06)'
                : 'rgba(11, 15, 23, 0.78)',
              transition: 'border-color 0.2s ease, background-color 0.2s ease',
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                color: 'var(--accent-cyan)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 18,
              }}
            >
              <Upload size={22} />
            </div>

            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(1.45rem, 3vw, 2rem)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                margin: '0 0 10px',
              }}
            >
              {t.workspace.uploadTitle}
            </h1>
            <p style={{ color: 'var(--ink-secondary)', margin: '0 auto 10px', maxWidth: 500, fontSize: 14.5 }}>
              {t.workspace.uploadSubtitle}
            </p>
            <p className="mono" style={{ color: 'var(--ink-muted)', margin: '0 auto 26px', maxWidth: 540, fontSize: 11.5 }}>
              {t.workspace.uploadHint}
            </p>

            <input
              ref={fileInputRef}
              id="image-file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp"
              style={{ display: 'none' }}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) handleIngestFile(chosen);
              }}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
              <button
                id="select-image-btn"
                type="button"
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} />
                <span>{t.workspace.selectFile}</span>
              </button>
              <button
                id="load-sample-btn"
                type="button"
                className="btn-secondary"
                onClick={handleLoadSample}
              >
                <Sparkles size={15} />
                <span>{t.workspace.loadSampleBtn}</span>
              </button>
            </div>

            {ingestError && (
              <div
                style={{
                  marginTop: 18,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--accent-coral-soft)',
                  border: '1px solid rgba(248, 113, 113, 0.35)',
                  color: '#fecaca',
                  fontSize: 13,
                }}
              >
                {ingestError}
              </div>
            )}
          </div>

          {recentSessions.length > 0 && (
            <div className="panel-surface" style={{ padding: '16px 20px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                  {t.workspace.recentCases} ({recentSessions.length})
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 12, color: 'var(--accent-coral)' }}
                  onClick={async () => {
                    await clearAllLocalSessions();
                    setRecentSessions([]);
                  }}
                >
                  <Trash2 size={13} />
                  <span>{t.workspace.clearSessions}</span>
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                {recentSessions.map((rec) => (
                  <div
                    key={rec.caseData.caseId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: 8,
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--border-hairline)',
                      background: 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <img
                      src={rec.thumbnailDataUrl}
                      alt={rec.caseData.imageValidation.fileName}
                      style={{ width: 44, height: 44, borderRadius: 4, objectFit: 'cover' }}
                    />
                    <button
                      type="button"
                      onClick={() => handleOpenStoredSession(rec)}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        color: 'var(--ink-primary)',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 500,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {rec.caseData.imageValidation.fileName}
                      </div>
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>
                        {rec.caseData.hypotheses[0]?.nearestPlace?.name || rec.caseData.ambiguity.classification}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ padding: 4, color: 'var(--ink-muted)' }}
                      aria-label="Delete session"
                      onClick={async () => {
                        await deleteLocalSession(rec.caseData.caseId);
                        setRecentSessions(await listLocalSessions());
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==================== STATE 1+: ACTIVE WORKSPACE ====================
  const selectedHyp = activeCase.hypotheses.find((h) => h.id === activeCase.selectedHypothesisId) || null;
  const badgeMeta = classificationBadge(activeCase.ambiguity.classification);
  const BadgeIcon = badgeMeta.icon;

  const showLeadsColumn = !isMobile || mobilePane === 'leads' || mobilePane === 'evidence';
  const showMapColumn = !isMobile || mobilePane === 'map';

  return (
    <div className="workspace-root">
      {/* Mobile Pane Switcher */}
      {isMobile && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-hairline)',
            background: 'var(--bg-surface)',
          }}
        >
          <button
            type="button"
            className={`btn-secondary`}
            style={{
              flex: 1,
              padding: '7px 8px',
              fontSize: 12.5,
              borderColor: mobilePane === 'leads' ? 'var(--accent-cyan)' : undefined,
              background: mobilePane === 'leads' ? 'var(--accent-cyan-soft)' : undefined,
            }}
            onClick={() => setMobilePane('leads')}
          >
            <ImageIcon size={14} />
            <span>{t.workspace.switchPhoto}</span>
          </button>
          <button
            type="button"
            className={`btn-secondary`}
            style={{
              flex: 1,
              padding: '7px 8px',
              fontSize: 12.5,
              borderColor: mobilePane === 'map' ? 'var(--accent-cyan)' : undefined,
              background: mobilePane === 'map' ? 'var(--accent-cyan-soft)' : undefined,
            }}
            onClick={() => setMobilePane('map')}
          >
            <MapIcon size={14} />
            <span>{t.workspace.switchMap}</span>
          </button>
          <button
            type="button"
            className={`btn-secondary`}
            style={{
              flex: 1,
              padding: '7px 8px',
              fontSize: 12.5,
              borderColor: mobilePane === 'evidence' ? 'var(--accent-cyan)' : undefined,
              background: mobilePane === 'evidence' ? 'var(--accent-cyan-soft)' : undefined,
            }}
            onClick={() => setMobilePane('evidence')}
          >
            <FileText size={14} />
            <span>{pt ? 'Evidências' : 'Evidence'}</span>
          </button>
        </div>
      )}

      <div className="workspace-grid">
        {/* LEFT SIDEBAR: PHOTO + MODEL GATE + HYPOTHESES + EVIDENCE TABS */}
        {showLeadsColumn && (
          <aside className="workspace-sidebar">
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Top Action & Classification Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span className={`status-badge ${badgeMeta.className}`}>
                  <BadgeIcon size={13} />
                  <span>{badgeMeta.label}</span>
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{ fontSize: 12 }}
                  onClick={handleResetWorkspace}
                >
                  <Upload size={13} />
                  <span>{t.workspace.newAnalysis}</span>
                </button>
              </div>

              {(!isMobile || mobilePane === 'leads') && (
                <>
                  <ImageEvidenceViewer
                    imageUrl={activeImageUrl}
                    validation={activeCase.imageValidation}
                    lang={lang}
                    observedShadowAzimuthDeg={activeCase.observedShadowAzimuthDeg}
                    compact={isMobile}
                  />

                  {/* ON-DEMAND MODEL DOWNLOAD & EXECUTION GATE */}
                  {(visualStatus === 'awaiting_consent' ||
                    visualStatus === 'running' ||
                    visualStatus === 'cancelled' ||
                    visualStatus === 'error') && (
                    <div
                      style={{
                        padding: 13,
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-strong)',
                        background: 'rgba(15, 23, 42, 0.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 13.5, fontFamily: 'var(--font-display)' }}>
                          {t.workspace.modelGateTitle}
                        </strong>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent-cyan)' }}>
                          {capabilities.webgpu ? 'WebGPU' : capabilities.wasmSimd ? 'WASM SIMD' : 'WASM'}
                        </span>
                      </div>

                      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-secondary)' }}>
                        {t.workspace.modelGateDesc}
                      </p>

                      {visualStatus !== 'running' && (
                        <>
                          <select
                            aria-label="Model precision variant"
                            value={selectedDtype}
                            onChange={(e) => setSelectedDtype(e.target.value as ModelDtype)}
                            style={{
                              background: '#05070b',
                              color: 'var(--ink-primary)',
                              border: '1px solid var(--border-hairline)',
                              borderRadius: 'var(--radius-xs)',
                              padding: '7px 10px',
                              fontSize: 12,
                            }}
                          >
                            <option value="q4">{t.workspace.modelChoiceQ4}</option>
                            <option value="int8">{t.workspace.modelChoiceInt8}</option>
                          </select>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <button
                              id="start-model-btn"
                              type="button"
                              className="btn-primary"
                              disabled={activeCase.ocr.status === 'downloading' || activeCase.ocr.status === 'running'}
                              style={{ flex: 1, padding: '9px 14px', fontSize: 12.5 }}
                              onClick={() =>
                                activeBuffer &&
                                executeVisualModel(activeCase, activeBuffer, selectedDtype)
                              }
                            >
                              <Download size={14} />
                              <span>
                                {modelCached
                                  ? pt
                                    ? 'Executar Análise Visual (Cache)'
                                    : 'Run Visual Analysis (Cached)'
                                  : t.workspace.downloadAndRun}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ padding: '9px 12px', fontSize: 12 }}
                              onClick={() => setVisualStatus('skipped')}
                            >
                              {t.workspace.skipVisionModel}
                            </button>
                          </div>
                        </>
                      )}

                      {visualStatus === 'running' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                            <span style={{ color: 'var(--ink-secondary)' }}>
                              {modelProgress.stage === 'downloading_model'
                                ? t.workspace.downloadingModel
                                : modelProgress.stage === 'building_location_index'
                                  ? t.workspace.buildingIndex
                                  : modelProgress.stage === 'running_vision'
                                    ? t.workspace.runningVision
                                    : t.workspace.clusteringResults}
                            </span>
                            <span className="mono" style={{ color: 'var(--accent-cyan)' }}>
                              {modelProgress.percent}%
                            </span>
                          </div>
                          <div
                            style={{
                              height: 6,
                              borderRadius: 999,
                              background: 'rgba(255,255,255,0.08)',
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: '100%',
                                width: `${Math.max(4, modelProgress.percent)}%`,
                                background: 'var(--accent-cyan)',
                                transition: 'width 0.2s ease',
                              }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                            <span className="mono" style={{ color: 'var(--ink-muted)' }}>
                              {modelProgress.downloadedBytes && modelProgress.totalBytes
                                ? `${formatBytesMb(modelProgress.downloadedBytes)} / ${formatBytesMb(modelProgress.totalBytes)}`
                                : modelProgress.detail || ''}
                            </span>
                            <button
                              id="cancel-model-btn"
                              type="button"
                              className="btn-ghost"
                              style={{ padding: '4px 8px', color: 'var(--accent-coral)' }}
                              onClick={() => {
                                cancelVisualGeolocation();
                                setVisualStatus('cancelled');
                              }}
                            >
                              <X size={13} />
                              <span>{t.workspace.cancelDownload}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {visualStatus === 'error' && visualError && (
                        <div style={{ fontSize: 12, color: '#fecaca' }}>
                          {pt ? 'Falha na inferência visual:' : 'Visual inference unavailable:'} {visualError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Ambiguity / Inconclusive Contextual Banner */}
                  {visualStatus === 'complete' && activeCase.ambiguity.isInconclusive && (
                    <div
                      role="alert"
                      style={{
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-xs)',
                        background: 'var(--accent-coral-soft)',
                        border: '1px solid rgba(248, 113, 113, 0.34)',
                        fontSize: 12.5,
                        color: '#fecaca',
                      }}
                    >
                      <strong style={{ display: 'block', marginBottom: 4 }}>
                        {t.workspace.classificationInconclusive}
                      </strong>
                      {t.workspace.inconclusiveBanner}
                    </div>
                  )}

                  {visualStatus === 'complete' &&
                    !activeCase.ambiguity.isInconclusive &&
                    activeCase.ambiguity.isAmbiguous && (
                      <div
                        style={{
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--accent-amber-soft)',
                          border: '1px solid rgba(245, 158, 11, 0.34)',
                          fontSize: 12.5,
                          color: '#fde68a',
                        }}
                      >
                        {t.workspace.ambiguousBanner}
                      </div>
                    )}

                  {/* Independent evidence: automatic OCR and opt-in cultural scene clues. */}
                  <div
                    style={{
                      padding: '11px 12px',
                      border: '1px solid var(--border-hairline)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      background: 'rgba(255, 255, 255, 0.018)',
                    }}
                  >
                    <strong style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {pt ? 'Análise complementar de pistas' : 'Independent contextual evidence'}
                    </strong>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>
                      {activeCase.ocr.status === 'downloading' || activeCase.ocr.status === 'running'
                        ? (pt ? 'OCR automático local em curso' : 'Automatic local OCR running') + ` · ${activeCase.ocr.progress}%`
                        : activeCase.ocr.status === 'complete'
                          ? (pt ? 'OCR automático concluído' : 'Automatic OCR complete') +
                            ` · ${activeCase.ocr.matchedGazetteerPlaces.length} ` +
                            (pt ? 'possíveis topónimos' : 'potential place names')
                          : activeCase.ocr.status === 'error'
                            ? (pt ? 'OCR indisponível; o modelo visual mantém-se utilizável.' : 'OCR unavailable; visual estimation remains available.')
                            : (pt ? 'O OCR não substitui uma verificação independente.' : 'OCR evidence requires independent verification.')}
                    </span>
                    <button
                      id="cultural-clue-btn"
                      type="button"
                      className="btn-secondary"
                      style={{ fontSize: 12, justifyContent: 'center' }}
                      disabled={culturalStatus === 'running'}
                      onClick={handleCulturalClues}
                    >
                      <ScanText size={13} />
                      <span>{culturalStatus === 'running'
                        ? (pt ? `A analisar símbolos… ${culturalProgress}%` : `Scanning cultural symbols… ${culturalProgress}%`)
                        : (pt ? 'Reconhecer símbolos culturais (opcional)' : 'Identify cultural symbols (optional)')}
                      </span>
                    </button>
                    {culturalStatus === 'idle' && (
                      <span style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>
                        {pt
                          ? 'Modelo CLIP adicional (~150 MB), descarregado apenas com autorização. Não envia a fotografia. Um símbolo cultural não demonstra onde a imagem foi captada.'
                          : 'Additional local CLIP model (~150 MB), downloaded only when requested. No image upload. A cultural symbol does not prove where a photo was taken.'}
                      </span>
                    )}
                    {culturalStatus === 'error' && (
                      <span role="alert" style={{ fontSize: 11.5, color: '#fecaca', overflowWrap: 'anywhere' }}>
                        {culturalError}
                      </span>
                    )}
                    {culturalStatus === 'complete' && (
                      <div style={{ fontSize: 11.5, color: 'var(--ink-secondary)' }}>
                        {activeCase.culturalClues?.length ? activeCase.culturalClues.map((clue) => (
                          <div key={clue.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <strong style={{ color: 'var(--ink-primary)' }}>{clue.label}</strong>
                            <span>{pt
                              ? 'Indício visual exploratório — ' + clue.association
                              : 'Exploratory visual clue — ' + clue.association}</span>
                            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-muted)' }}>
                              {pt ? 'Afinidade entre descrições, não probabilidade:' : 'Relative label affinity, not probability:'}
                              {' '}{(clue.score * 100).toFixed(1)}%
                            </span>
                          </div>
                        )) : (pt
                          ? 'Nenhum símbolo foi distinguido com margem suficiente. Não se conclui a ausência de referências culturais.'
                          : 'No distinctive symbol passed the comparison margin. Cultural references may still be present.')}
                      </div>
                    )}
                  </div>

                  {/* Geographic Hypotheses List (up to 5) */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 8,
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--ink-secondary)' }}
                      >
                        {t.workspace.hypothesesTitle.toUpperCase()} ({activeCase.hypotheses.length})
                      </span>
                      {activeCase.modelInfo.inferenceDurationMs > 0 && (
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-muted)' }}>
                          {(activeCase.modelInfo.inferenceDurationMs / 1000).toFixed(1)}s ·{' '}
                          {activeCase.modelInfo.executionProvider.toUpperCase()}
                        </span>
                      )}
                    </div>

                    {activeCase.hypotheses.length === 0 ? (
                      <div
                        style={{
                          padding: '12px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-hairline)',
                          fontSize: 12.5,
                          color: 'var(--ink-muted)',
                        }}
                      >
                        {pt
                          ? 'Sem coordenadas ainda. Execute o modelo visual ou defina um pino manual no mapa.'
                          : 'No coordinates yet. Initialize the visual engine or drop a manual pin on the map.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {activeCase.hypotheses.map((h) => {
                          const isSelected = h.id === activeCase.selectedHypothesisId;
                          const placeTitle = h.nearestPlace
                            ? [
                                h.nearestPlace.name,
                                h.nearestPlace.region && h.nearestPlace.region !== h.nearestPlace.name
                                  ? h.nearestPlace.region
                                  : null,
                                h.nearestPlace.countryName,
                              ]
                                .filter(Boolean)
                                .join(', ')
                            : formatCoordPair(h.lat, h.lon);
                          return (
                            <div
                              key={h.id}
                              style={{
                                border: isSelected
                                  ? '1px solid var(--accent-cyan)'
                                  : '1px solid var(--border-hairline)',
                                background: isSelected
                                  ? 'rgba(56, 189, 248, 0.08)'
                                  : 'rgba(255, 255, 255, 0.02)',
                                borderRadius: 'var(--radius-sm)',
                                padding: '10px 12px',
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveCase((prev) =>
                                    prev ? { ...prev, selectedHypothesisId: h.id } : prev
                                  );
                                  mapHandleRef.current?.flyToCoord(h.lat, h.lon, 11.5);
                                  if (isMobile) setMobilePane('map');
                                }}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  background: 'none',
                                  border: 'none',
                                  padding: 0,
                                  color: 'inherit',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                                    <span
                                      className="mono"
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: '1px 6px',
                                        borderRadius: 4,
                                        background:
                                          h.source === 'exif_gps'
                                            ? 'var(--accent-emerald-soft)'
                                            : h.source === 'manual_override'
                                              ? 'var(--accent-amber-soft)'
                                              : h.source === 'ocr_gazetteer'
                                                ? 'rgba(45, 212, 191, 0.16)'
                                                : 'var(--accent-cyan-soft)',
                                        color:
                                          h.source === 'exif_gps'
                                            ? 'var(--accent-emerald)'
                                            : h.source === 'manual_override'
                                              ? 'var(--accent-amber)'
                                              : h.source === 'ocr_gazetteer'
                                                ? '#2dd4bf'
                                                : 'var(--accent-cyan)',
                                      }}
                                    >
                                      {h.source === 'exif_gps'
                                        ? 'EXIF GPS'
                                        : h.source === 'manual_override'
                                          ? 'MANUAL'
                                          : h.source === 'ocr_gazetteer'
                                            ? 'OCR'
                                            : `#${h.rank}`}
                                    </span>
                                    <strong style={{ fontSize: 13.5, fontWeight: 600 }}>
                                      {placeTitle}
                                    </strong>
                                  </div>
                                  <div className="mono" style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>
                                    {formatCoordPair(h.lat, h.lon)}
                                    {h.source === 'ocr_gazetteer'
                                      ? ' · GeoNames OCR lead'
                                      : h.nearestPlace &&
                                        ` · ${h.nearestPlace.distanceKm} km ${h.nearestPlace.compass} of ${h.nearestPlace.name}`}
                                  </div>
                                </div>

                                {h.source === 'visual_model' && (
                                  <span
                                    className="mono"
                                    title={t.workspace.relativeShareTooltip}
                                    style={{
                                      fontSize: 11,
                                      color: 'var(--ink-secondary)',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                      flexShrink: 0,
                                    }}
                                  >
                                    {(h.relativeAffinity * 100).toFixed(1)}%
                                    <Info size={11} />
                                  </span>
                                )}
                              </button>

                              {/* Hypothesis Corroboration & Investigator Verification Row */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  marginTop: 7,
                                  paddingTop: 7,
                                  borderTop: '1px solid var(--border-hairline)',
                                }}
                              >
                                <span style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>
                                  {h.matchedTextClues.length > 0
                                    ? `OCR: ${h.matchedTextClues.join(', ')}`
                                    : h.solarCheck
                                      ? `Sun Alt ${h.solarCheck.sunAltitudeDeg}° · ${h.solarCheck.consistencyLabel}`
                                      : h.source === 'visual_model'
                                        ? `${h.supportPointsCount} gallery pts · logit ${h.peakLogit}`
                                        : 'File GPS metadata'}
                                </span>
                                <button
                                  type="button"
                                  className="btn-ghost"
                                  style={{
                                    padding: '2px 7px',
                                    fontSize: 11,
                                    color: h.verifiedByInvestigator ? 'var(--accent-emerald)' : undefined,
                                  }}
                                  onClick={() => handleVerifyCandidate(h.id)}
                                >
                                  <CheckCircle2 size={12} />
                                  <span>
                                    {h.verifiedByInvestigator
                                      ? t.workspace.verifiedBadge
                                      : t.workspace.verifyCandidate}
                                  </span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Progressive Evidence Tools Section */}
              {(!isMobile || mobilePane === 'evidence') && (
                <div
                  style={{
                    borderTop: '1px solid var(--border-hairline)',
                    paddingTop: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 4,
                      marginBottom: 12,
                    }}
                  >
                    {(
                      [
                        { id: 'metadata', label: t.workspace.metadataTab, icon: Camera },
                        { id: 'ocr', label: t.workspace.ocrTab, icon: ScanText },
                        { id: 'solar', label: t.workspace.solarTab, icon: Sun },
                        { id: 'triangulation', label: t.workspace.triangulationTab, icon: Compass },
                        { id: 'references', label: t.workspace.referencesTab, icon: ImageIcon },
                        { id: 'notes', label: t.workspace.notesTab, icon: ClipboardEdit },
                      ] as const
                    ).map((tab) => {
                      const Icon = tab.icon;
                      const active = activeTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          className="btn-ghost"
                          style={{
                            padding: '5px 8px',
                            fontSize: 11.5,
                            color: active ? 'var(--accent-cyan)' : undefined,
                            background: active ? 'var(--accent-cyan-soft)' : undefined,
                          }}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          <Icon size={12} />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* TAB: EXIF & FILE */}
                  {activeTab === 'metadata' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                      {!activeCase.metadata.hasExif ? (
                        <p style={{ margin: 0, color: 'var(--ink-secondary)' }}>{t.workspace.noExifFound}</p>
                      ) : (
                        <dl
                          style={{
                            margin: 0,
                            display: 'grid',
                            gridTemplateColumns: '120px 1fr',
                            gap: '6px 10px',
                          }}
                        >
                          <dt style={{ color: 'var(--ink-muted)' }}>EXIF Tags</dt>
                          <dd className="mono" style={{ margin: 0 }}>{activeCase.metadata.rawTagsCount}</dd>
                          <dt style={{ color: 'var(--ink-muted)' }}>GPS IFD</dt>
                          <dd className="mono" style={{ margin: 0 }}>
                            {activeCase.metadata.hasGps && activeCase.metadata.gps
                              ? formatCoordPair(activeCase.metadata.gps.lat, activeCase.metadata.gps.lon)
                              : pt ? 'Ausente' : 'None'}
                          </dd>
                          <dt style={{ color: 'var(--ink-muted)' }}>Camera</dt>
                          <dd style={{ margin: 0 }}>
                            {[activeCase.metadata.cameraMake, activeCase.metadata.cameraModel]
                              .filter(Boolean)
                              .join(' ') || '—'}
                          </dd>
                          <dt style={{ color: 'var(--ink-muted)' }}>Capture UTC</dt>
                          <dd className="mono" style={{ margin: 0 }}>
                            {activeCase.metadata.dateTimeOriginal || '—'}
                          </dd>
                          <dt style={{ color: 'var(--ink-muted)' }}>Optics</dt>
                          <dd className="mono" style={{ margin: 0 }}>
                            {activeCase.metadata.focalLengthMm
                              ? `${activeCase.metadata.focalLengthMm}mm`
                              : '—'}{' '}
                            · f/{activeCase.metadata.fNumber || '—'} · ISO {activeCase.metadata.iso || '—'}
                          </dd>
                        </dl>
                      )}
                      <div
                        className="mono"
                        style={{
                          padding: '7px 9px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'rgba(255,255,255,0.02)',
                          border: '1px solid var(--border-hairline)',
                          fontSize: 10.5,
                          wordBreak: 'break-all',
                          color: 'var(--ink-muted)',
                        }}
                      >
                        SHA-256: {activeCase.imageValidation.sha256}
                      </div>
                    </div>
                  )}

                  {/* TAB: LOCAL OCR */}
                  {activeTab === 'ocr' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <select
                          aria-label="OCR language"
                          value={ocrLang}
                          onChange={(e) => setOcrLang(e.target.value)}
                          style={{
                            background: '#05070b',
                            color: 'var(--ink-primary)',
                            border: '1px solid var(--border-hairline)',
                            borderRadius: 'var(--radius-xs)',
                            padding: '6px 8px',
                            fontSize: 12,
                          }}
                        >
                          <option value="eng+por">English + Português (automático)</option>
                          <option value="eng">English (eng)</option>
                          <option value="por">Português (por)</option>
                          <option value="spa">Español (spa)</option>
                          <option value="fra">Français (fra)</option>
                          <option value="deu">Deutsch (deu)</option>
                        </select>
                        {activeCase.ocr.status === 'downloading' || activeCase.ocr.status === 'running' ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ flex: 1, fontSize: 12 }}
                            onClick={() => void import('../engine/ocr').then((m) => m.cancelLocalOcr())}
                          >
                            <X size={13} />
                            <span>
                              {t.workspace.cancelOcr} ({activeCase.ocr.progress}%)
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ flex: 1, fontSize: 12 }}
                            onClick={handleRunOcr}
                          >
                            <ScanText size={13} />
                            <span>{t.workspace.runOcr}</span>
                          </button>
                        )}
                      </div>

                      {activeCase.ocr.status === 'complete' && (
                        <>
                          <div
                            className="mono"
                            style={{
                              padding: 8,
                              borderRadius: 'var(--radius-xs)',
                              background: '#05070b',
                              border: '1px solid var(--border-hairline)',
                              fontSize: 11,
                              maxHeight: 90,
                              overflowY: 'auto',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {activeCase.ocr.rawText || (pt ? '(Sem texto legível)' : '(No legible text)')}
                          </div>
                          {activeCase.ocr.matchedGazetteerPlaces.length === 0 ? (
                            <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                              {t.workspace.noOcrMatches}
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {activeCase.ocr.matchedGazetteerPlaces.map((m) => (
                                <button
                                  key={`${m.token}-${m.name}`}
                                  type="button"
                                  className="btn-secondary"
                                  style={{ justifyContent: 'space-between', fontSize: 12, padding: '6px 10px' }}
                                  onClick={() => {
                                    mapHandleRef.current?.flyToCoord(m.lat, m.lon, 11);
                                    if (isMobile) setMobilePane('map');
                                  }}
                                >
                                  <span>
                                    &ldquo;{m.token}&rdquo; → {m.name}, {m.countryCode}
                                  </span>
                                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--accent-cyan)' }}>
                                    Fly
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* TAB: SOLAR AZIMUTH */}
                  {activeTab === 'solar' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ color: 'var(--ink-secondary)', fontSize: 11.5 }}>
                          {pt ? 'Data/Hora UTC (EXIF ou Manual)' : 'Capture UTC Timestamp (EXIF or Manual)'}
                        </span>
                        <input
                          type="datetime-local"
                          value={(
                            activeCase.manualTimestampIso ||
                            activeCase.metadata.dateTimeOriginal ||
                            activeCase.metadata.gps?.timestampIso ||
                            ''
                          ).slice(0, 16)}
                          onChange={(e) => {
                            const val = e.target.value ? `${e.target.value}:00.000Z` : undefined;
                            handleSolarChange(undefined, val);
                          }}
                          style={{
                            background: '#05070b',
                            color: 'var(--ink-primary)',
                            border: '1px solid var(--border-hairline)',
                            borderRadius: 'var(--radius-xs)',
                            padding: '6px 8px',
                            fontSize: 12,
                          }}
                        />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                          <span style={{ color: 'var(--ink-secondary)' }}>
                            {pt ? 'Azimute de Sombra Observado (° N)' : 'Observed Shadow Azimuth (° from North)'}
                          </span>
                          <span className="mono" style={{ color: 'var(--accent-amber)' }}>
                            {typeof activeCase.observedShadowAzimuthDeg === 'number'
                              ? `${activeCase.observedShadowAzimuthDeg}°`
                              : '—'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={359}
                          value={activeCase.observedShadowAzimuthDeg ?? 180}
                          onChange={(e) => handleSolarChange(Number(e.target.value), undefined)}
                        />
                      </label>

                      {selectedHyp?.solarCheck ? (
                        <div
                          className="mono"
                          style={{
                            padding: 9,
                            borderRadius: 'var(--radius-xs)',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid var(--border-hairline)',
                            fontSize: 11.5,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <div>
                            Sun Altitude: {selectedHyp.solarCheck.sunAltitudeDeg}° · Sun Azimuth:{' '}
                            {selectedHyp.solarCheck.sunAzimuthDeg}°
                          </div>
                          <div>
                            Expected Shadow Bearing: {selectedHyp.solarCheck.expectedShadowDirectionDeg}°
                          </div>
                          <div>
                            Status:{' '}
                            <strong style={{ color: 'var(--accent-cyan)' }}>
                              {selectedHyp.solarCheck.consistencyLabel.toUpperCase()}
                            </strong>
                            {typeof selectedHyp.solarCheck.angularDeltaDeg === 'number' &&
                              ` (Δ ${selectedHyp.solarCheck.angularDeltaDeg}°)`}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                          {pt
                            ? 'Defina uma data/hora UTC e selecione um candidato para verificar o azimute solar no mapa.'
                            : 'Provide a UTC timestamp and select a candidate to compute solar angle and shadow vector.'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* TAB: TRIANGULATION & MEASUREMENT */}
                  {activeTab === 'triangulation' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ flex: 1, fontSize: 12 }}
                          onClick={() => {
                            setMapMode('bearing_ray');
                            if (isMobile) setMobilePane('map');
                          }}
                        >
                          <Compass size={13} />
                          <span>{t.workspace.rayMode}</span>
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ flex: 1, fontSize: 12 }}
                          onClick={() => {
                            setMapMode('measure');
                            if (isMobile) setMobilePane('map');
                          }}
                        >
                          <span>{t.workspace.measureMode}</span>
                        </button>
                      </div>

                      {triangulationIntersection && (
                        <div
                          className="mono"
                          style={{
                            padding: 9,
                            borderRadius: 'var(--radius-xs)',
                            background: 'rgba(253, 224, 71, 0.08)',
                            border: '1px solid rgba(253, 224, 71, 0.3)',
                            color: '#fef08a',
                            fontSize: 11.5,
                          }}
                        >
                          Intersection: {formatCoordPair(triangulationIntersection.lat, triangulationIntersection.lon)}
                        </div>
                      )}

                      {activeCase.triangulationRays.length === 0 ? (
                        <span style={{ color: 'var(--ink-muted)', fontSize: 12 }}>
                          {pt
                            ? 'Trace 2 ou mais linhas de azimute no mapa para calcular automaticamente a interseção.'
                            : 'Draw 2+ bearing rays on the map to automatically compute spherical intersection.'}
                        </span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {activeCase.triangulationRays.map((r) => (
                            <div
                              key={r.id}
                              className="mono"
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 9px',
                                border: '1px solid var(--border-hairline)',
                                borderRadius: 'var(--radius-xs)',
                                fontSize: 11,
                              }}
                            >
                              <span>
                                {r.bearingDeg}° from {r.originLat.toFixed(3)}, {r.originLon.toFixed(3)}
                              </span>
                              <button
                                type="button"
                                className="btn-ghost"
                                style={{ padding: 2, color: 'var(--accent-coral)' }}
                                onClick={() =>
                                  setActiveCase((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          triangulationRays: prev.triangulationRays.filter(
                                            (x) => x.id !== r.id
                                          ),
                                        }
                                      : prev
                                  )
                                }
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: WIKIMEDIA OPEN REFERENCES */}
                  {activeTab === 'references' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-secondary)' }}>
                        {t.workspace.wikimediaPrivacyNote}
                      </p>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={!selectedHyp || wikimediaLoading}
                        onClick={handleWikimediaLookup}
                      >
                        <ImageIcon size={14} />
                        <span>
                          {wikimediaLoading
                            ? pt
                              ? 'A pesquisar...'
                              : 'Searching...'
                            : t.workspace.searchWikimedia}
                        </span>
                      </button>
                      {wikimediaError && (
                        <span style={{ color: '#fecaca', fontSize: 12 }}>{wikimediaError}</span>
                      )}
                      {wikimediaRefs.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          {wikimediaRefs.map((ref) => (
                            <a
                              key={ref.pageId}
                              href={ref.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                border: '1px solid var(--border-hairline)',
                                borderRadius: 'var(--radius-xs)',
                                overflow: 'hidden',
                                background: 'rgba(255,255,255,0.02)',
                                display: 'flex',
                                flexDirection: 'column',
                              }}
                            >
                              <img
                                src={ref.thumbUrl}
                                alt={ref.title}
                                loading="lazy"
                                style={{ width: '100%', height: 82, objectFit: 'cover' }}
                              />
                              <div style={{ padding: 6, fontSize: 10.5 }}>
                                <div
                                  style={{
                                    color: 'var(--ink-primary)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {ref.title}
                                </div>
                                <div
                                  className="mono"
                                  style={{
                                    color: 'var(--ink-muted)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    marginTop: 2,
                                  }}
                                >
                                  <span>{ref.distanceMeters} m · {ref.license}</span>
                                  <ExternalLink size={10} />
                                </div>
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB: REPORT & NOTES */}
                  {activeTab === 'notes' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <textarea
                        rows={4}
                        placeholder={
                          pt
                            ? 'Notas do investigador, referências arquitetónicas ou conclusões...'
                            : 'Investigator notes, structural cues, or verification rationale...'
                        }
                        value={activeCase.investigatorNotes}
                        onChange={(e) =>
                          setActiveCase((prev) =>
                            prev ? { ...prev, investigatorNotes: e.target.value } : prev
                          )
                        }
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          background: '#05070b',
                          color: 'var(--ink-primary)',
                          border: '1px solid var(--border-hairline)',
                          borderRadius: 'var(--radius-xs)',
                          padding: 10,
                          fontSize: 12.5,
                        }}
                      />

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ flex: 1, fontSize: 12 }}
                          onClick={handleSaveSession}
                        >
                          <Save size={14} />
                          <span>
                            {sessionSavedFlash
                              ? pt
                                ? 'Guardado (IndexedDB)'
                                : 'Saved Locally'
                              : pt
                                ? 'Guardar Sessão Local'
                                : 'Save Local Session'}
                          </span>
                        </button>
                        <button
                          id="export-pdf-btn"
                          type="button"
                          className="btn-primary"
                          style={{ flex: 1, padding: '9px 14px', fontSize: 12.5 }}
                          onClick={handleExportPdf}
                        >
                          <FileText size={14} />
                          <span>{t.workspace.exportPdf}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}

        {/* RIGHT STAGE: INTERACTIVE CARTOGRAPHIC WORKSPACE */}
        {showMapColumn && (
          <section className="workspace-stage">
            <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
              <MapWorkspace
                ref={mapHandleRef}
                lang={lang}
                capabilities={capabilities}
                hypotheses={activeCase.hypotheses}
                selectedHypothesisId={activeCase.selectedHypothesisId}
                classification={activeCase.ambiguity.classification}
                mode={mapMode}
                onModeChange={setMapMode}
                onSelectHypothesis={(id) =>
                  setActiveCase((prev) => (prev ? { ...prev, selectedHypothesisId: id } : prev))
                }
                onSetManualPin={handleSetManualPin}
                measurements={activeCase.measurements}
                onUpdateMeasurements={(lines) =>
                  setActiveCase((prev) => (prev ? { ...prev, measurements: lines } : prev))
                }
                triangulationRays={activeCase.triangulationRays}
                onAddTriangulationRay={(ray) =>
                  setActiveCase((prev) =>
                    prev
                      ? { ...prev, triangulationRays: [...prev.triangulationRays, ray] }
                      : prev
                  )
                }
                triangulationIntersection={triangulationIntersection}
              />
            </div>

            {isMobile && activeCase.hypotheses.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '8px 12px',
                  overflowX: 'auto',
                  background: 'var(--bg-surface)',
                  borderTop: '1px solid var(--border-hairline)',
                }}
              >
                {activeCase.hypotheses.map((h) => {
                  const selected = h.id === activeCase.selectedHypothesisId;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className="btn-secondary mono"
                      style={{
                        flexShrink: 0,
                        padding: '5px 10px',
                        fontSize: 11.5,
                        borderColor: selected ? 'var(--accent-cyan)' : undefined,
                        background: selected ? 'var(--accent-cyan-soft)' : undefined,
                      }}
                      onClick={() => {
                        setActiveCase((prev) =>
                          prev ? { ...prev, selectedHypothesisId: h.id } : prev
                        );
                        mapHandleRef.current?.flyToCoord(h.lat, h.lon, 11.5);
                      }}
                    >
                      {h.source === 'exif_gps' ? 'GPS' : h.source === 'manual_override' ? 'M' : `#${h.rank}`}{' '}
                      {h.nearestPlace?.name || `${h.lat.toFixed(2)},${h.lon.toFixed(2)}`}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
