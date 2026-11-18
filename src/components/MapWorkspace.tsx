import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ErrorEvent as MapErrorEvent,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(maplibreWorkerUrl);
import {
  Compass,
  Globe,
  MapPin,
  Mountain,
  Ruler,
  Crosshair,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import coastlinesRaw from '../assets/coastlines-110m.json';
import {
  loadCartographicStyle,
  TERRARIUM_ATTRIBUTION,
  TERRARIUM_TILES,
  type MapTheme,
} from '../engine/cartography';
import { destinationPoint, formatCoordPair, haversineKm, initialBearingDeg } from '../engine/geoMath';
import { TRANSLATIONS } from '../i18n/translations';
import type {
  GeoHypothesis,
  Language,
  MeasurementLine,
  PredictionConfidenceClass,
  RuntimeCapabilities,
  TriangulationRay,
} from '../types/geoint';

export type MapInteractionMode = 'inspect' | 'manual_pin' | 'measure' | 'bearing_ray';

export interface MapWorkspaceHandle {
  captureSnapshotDataUrl: () => string | undefined;
  flyToCoord: (lat: number, lon: number, zoom?: number) => void;
}

interface MapWorkspaceProps {
  lang: Language;
  capabilities: RuntimeCapabilities;
  hypotheses: GeoHypothesis[];
  selectedHypothesisId: string | null;
  classification: PredictionConfidenceClass;
  mode: MapInteractionMode;
  onModeChange: (mode: MapInteractionMode) => void;
  onSelectHypothesis: (id: string) => void;
  onSetManualPin: (lat: number, lon: number) => void;
  measurements: MeasurementLine[];
  onUpdateMeasurements: (lines: MeasurementLine[]) => void;
  triangulationRays: TriangulationRay[];
  onAddTriangulationRay: (ray: TriangulationRay) => void;
  triangulationIntersection: { lat: number; lon: number; distFromRay1Km: number; distFromRay2Km: number } | null;
}

const SvgMapFallback: React.FC<{
  hypotheses: GeoHypothesis[];
  selectedHypothesisId: string | null;
  onSelectHypothesis: (id: string) => void;
  onSetManualPin: (lat: number, lon: number) => void;
  mode: MapInteractionMode;
  lang: Language;
}> = ({ hypotheses, selectedHypothesisId, onSelectHypothesis, onSetManualPin, mode, lang }) => {
  const pt = lang === 'pt-PT';
  const paths = (coastlinesRaw as Array<Array<[number, number]>>)
    .map((line) =>
      line
        .map(([lon, lat], idx) => {
          const x = ((lon + 180) / 360) * 1000;
          const y = ((90 - lat) / 180) * 500;
          return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ')
    )
    .join(' ');

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (mode !== 'manual_pin') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    const lon = xRatio * 360 - 180;
    const lat = 90 - yRatio * 180;
    onSetManualPin(Number(lat.toFixed(5)), Number(lon.toFixed(5)));
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#05080f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        className="mono"
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          fontSize: 11,
          color: 'var(--accent-amber)',
          background: 'rgba(11, 15, 23, 0.9)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: 'var(--radius-xs)',
          padding: '6px 10px',
        }}
      >
        {pt
          ? 'Modo Cartográfico 2D Vetorial (WebGL indisponível neste dispositivo)'
          : '2D Vector Cartographic Mode (WebGL unavailable on this device)'}
      </div>

      <svg
        viewBox="0 0 1000 500"
        onClick={handleSvgClick}
        style={{
          width: '100%',
          maxHeight: '100%',
          cursor: mode === 'manual_pin' ? 'crosshair' : 'default',
        }}
      >
        <rect x="0" y="0" width="1000" height="500" fill="#060910" rx="8" />
        <path d={paths} fill="none" stroke="rgba(148, 163, 184, 0.32)" strokeWidth="0.9" />
        {hypotheses.map((h) => {
          const x = ((h.lon + 180) / 360) * 1000;
          const y = ((90 - h.lat) / 180) * 500;
          const isSelected = h.id === selectedHypothesisId;
          const color =
            h.source === 'exif_gps'
              ? '#34d399'
              : h.source === 'manual_override'
                ? '#f59e0b'
                : h.source === 'ocr_gazetteer'
                  ? '#2dd4bf'
                  : '#38bdf8';
          return (
            <g
              key={h.id}
              style={{ cursor: 'pointer' }}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectHypothesis(h.id);
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 10 : 6}
                fill="none"
                stroke={color}
                strokeWidth="1.4"
                opacity={isSelected ? 0.9 : 0.45}
              />
              <circle cx={x} cy={y} r={isSelected ? 4.2 : 3} fill={color} />
              <text
                x={x + 8}
                y={y + 4}
                fill="#f3f5f8"
                fontSize="11"
                fontFamily="monospace"
              >
                {h.source === 'ocr_gazetteer' ? 'OCR' : `#${h.rank}`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export const MapWorkspace = React.forwardRef<MapWorkspaceHandle, MapWorkspaceProps>(
  (
    {
      lang,
      capabilities,
      hypotheses,
      selectedHypothesisId,
      classification,
      mode,
      onModeChange,
      onSelectHypothesis,
      onSetManualPin,
      measurements,
      onUpdateMeasurements,
      triangulationRays,
      onAddTriangulationRay,
      triangulationIntersection,
    },
    ref
  ) => {
    const t = TRANSLATIONS[lang];
    const pt = lang === 'pt-PT';

    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const markersRef = useRef<Marker[]>([]);

    const [theme, setTheme] = useState<MapTheme>('obsidian');
    const [useGlobe, setUseGlobe] = useState(false);
    const [useTerrain, setUseTerrain] = useState(false);
    const [offlineNotice, setOfflineNotice] = useState(false);
    const [webglCrashed, setWebglCrashed] = useState(false);
    const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number } | null>(null);
    const [pendingRayOrigin, setPendingRayOrigin] = useState<{ lat: number; lon: number } | null>(null);
    const [styleRevision, setStyleRevision] = useState(0);

    // Refs synced for event callbacks inside MapLibre listener closures
    const modeRef = useRef(mode);
    const measurementsRef = useRef(measurements);
    const pendingRayRef = useRef(pendingRayOrigin);
    const callbacksRef = useRef({
      onModeChange,
      onSetManualPin,
      onUpdateMeasurements,
      onAddTriangulationRay,
    });
    useEffect(() => {
      modeRef.current = mode;
      measurementsRef.current = measurements;
      pendingRayRef.current = pendingRayOrigin;
      callbacksRef.current = {
        onModeChange,
        onSetManualPin,
        onUpdateMeasurements,
        onAddTriangulationRay,
      };
    }, [mode, measurements, pendingRayOrigin, onModeChange, onSetManualPin, onUpdateMeasurements, onAddTriangulationRay]);

    useImperativeHandle(ref, () => ({
      captureSnapshotDataUrl: () => {
        try {
          const src = mapRef.current?.getCanvas();
          if (!src || src.width === 0 || src.height === 0) return undefined;
          const maxW = 1080;
          const scale = src.width > maxW ? maxW / src.width : 1;
          const w = Math.max(1, Math.round(src.width * scale));
          const h = Math.max(1, Math.round(src.height * scale));
          const off = document.createElement('canvas');
          off.width = w;
          off.height = h;
          const ctx = off.getContext('2d');
          if (!ctx) return src.toDataURL('image/jpeg', 0.84);
          ctx.fillStyle = '#05070b';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(src, 0, 0, w, h);
          return off.toDataURL('image/jpeg', 0.84);
        } catch {
          return undefined;
        }
      },
      flyToCoord: (lat: number, lon: number, zoom = 11.5) => {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo({
          center: [lon, lat],
          zoom,
          duration: capabilities.reducedMotion ? 0 : 1200,
          essential: true,
        });
      },
    }));

    // Initialize MapLibre GL
    useEffect(() => {
      if (!capabilities.webgl || !containerRef.current) return;

      let disposed = false;
      let map: MapLibreMap | null = null;

      (async () => {
        const { style, offlineFallback } = await loadCartographicStyle('obsidian');
        if (disposed || !containerRef.current) return;
        setOfflineNotice(offlineFallback);

        try {
          map = new MapLibreMap({
            container: containerRef.current,
            style,
            center: [-9.14, 38.72],
            zoom: 2.3,
            pitch: 0,
            canvasContextAttributes: {
              preserveDrawingBuffer: true,
              antialias: true,
            },
            attributionControl: false,
          });
        } catch {
          setWebglCrashed(true);
          return;
        }

        mapRef.current = map;

        map.addControl(
          new NavigationControl({ visualizePitch: true, showCompass: true }),
          'bottom-right'
        );
        map.addControl(new AttributionControl({ compact: true }), 'bottom-left');

        map.on('error', (e: MapErrorEvent) => {
          const msg = e?.error?.message || '';
          if (/Failed to fetch|NetworkError|tile/i.test(msg)) {
            setOfflineNotice(true);
          }
        });

        map.on('style.load', () => {
          setStyleRevision((r) => r + 1);
        });

        map.on('mousemove', (e: MapMouseEvent) => {
          setCursorCoords({
            lat: Number(e.lngLat.lat.toFixed(5)),
            lon: Number(e.lngLat.lng.toFixed(5)),
          });
        });

        map.on('click', (e: MapMouseEvent) => {
          const lat = Number(e.lngLat.lat.toFixed(5));
          const lon = Number(e.lngLat.lng.toFixed(5));
          const cb = callbacksRef.current;

          if (modeRef.current === 'manual_pin') {
            cb.onSetManualPin(lat, lon);
            cb.onModeChange('inspect');
            return;
          }

          if (modeRef.current === 'measure') {
            const existing = measurementsRef.current;
            const currentLine = existing[0] || {
              id: 'measure-1',
              points: [],
              totalKm: 0,
              bearingDeg: 0,
            };
            const nextPoints: Array<[number, number]> = [...currentLine.points, [lon, lat]];
            let totalKm = 0;
            for (let i = 1; i < nextPoints.length; i++) {
              totalKm += haversineKm(
                nextPoints[i - 1][1],
                nextPoints[i - 1][0],
                nextPoints[i][1],
                nextPoints[i][0]
              );
            }
            const lastBearing =
              nextPoints.length >= 2
                ? initialBearingDeg(
                    nextPoints[nextPoints.length - 2][1],
                    nextPoints[nextPoints.length - 2][0],
                    nextPoints[nextPoints.length - 1][1],
                    nextPoints[nextPoints.length - 1][0]
                  )
                : 0;
            cb.onUpdateMeasurements([
              {
                id: currentLine.id,
                points: nextPoints,
                totalKm: Number(totalKm.toFixed(3)),
                bearingDeg: Number(lastBearing.toFixed(1)),
              },
            ]);
            return;
          }

          if (modeRef.current === 'bearing_ray') {
            if (!pendingRayRef.current) {
              setPendingRayOrigin({ lat, lon });
            } else {
              const origin = pendingRayRef.current;
              const dist = haversineKm(origin.lat, origin.lon, lat, lon);
              if (dist >= 0.01) {
                const bearing = initialBearingDeg(origin.lat, origin.lon, lat, lon);
                cb.onAddTriangulationRay({
                  id: `ray-${Date.now()}`,
                  originLat: origin.lat,
                  originLon: origin.lon,
                  bearingDeg: Number(bearing.toFixed(1)),
                  lengthKm: Math.max(80, Math.round(dist * 3)),
                  label: `Ray ${Number(bearing.toFixed(0))}°`,
                });
              }
              setPendingRayOrigin(null);
            }
          }
        });
      })();

      return () => {
        disposed = true;
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      };
    }, [capabilities.webgl]);

    // Handle Theme Switch cleanly
    const handleThemeSwitch = async (nextTheme: MapTheme) => {
      setTheme(nextTheme);
      const map = mapRef.current;
      if (!map) return;
      const { style, offlineFallback } = await loadCartographicStyle(nextTheme);
      setOfflineNotice(offlineFallback);
      map.setStyle(style);
    };

    // Sync Globe Projection & 3D Terrain whenever style reloads or toggles change
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;

      try {
        map.setProjection({ type: useGlobe ? 'globe' : 'mercator' });
      } catch {
        // fallback if style is mid-transition
      }

      if (useTerrain && !offlineNotice) {
        try {
          if (!map.getSource('terrarium-dem')) {
            map.addSource('terrarium-dem', {
              type: 'raster-dem',
              tiles: TERRARIUM_TILES,
              tileSize: 256,
              encoding: 'terrarium',
              attribution: TERRARIUM_ATTRIBUTION,
            });
          }
          map.setTerrain({ source: 'terrarium-dem', exaggeration: 1.35 });
          map.easeTo({ pitch: Math.max(map.getPitch(), 44), duration: capabilities.reducedMotion ? 0 : 700 });
        } catch {
          queueMicrotask(() => setUseTerrain(false));
        }
      } else {
        try {
          map.setTerrain(null);
          if (map.getPitch() > 0) {
            map.easeTo({ pitch: 0, duration: capabilities.reducedMotion ? 0 : 450 });
          }
        } catch {
          // ignore
        }
      }
    }, [useGlobe, useTerrain, offlineNotice, styleRevision, capabilities.reducedMotion]);

    // Sync GeoJSON Overlays (Measurements, Triangulation Rays, Solar Shadow Vectors)
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !map.isStyleLoaded()) return;

      // 1. Measurements
      const measureFeatures = measurements
        .filter((l) => l.points.length >= 2)
        .map((l) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: l.points,
          },
        }));
      const measurePointFeatures = measurements.flatMap((l) =>
        l.points.map((ptCoord) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'Point' as const, coordinates: ptCoord },
        }))
      );

      // 2. Triangulation Rays
      const rayFeatures = triangulationRays.map((r) => {
        const [endLat, endLon] = destinationPoint(r.originLat, r.originLon, r.bearingDeg, r.lengthKm);
        return {
          type: 'Feature' as const,
          properties: { label: r.label },
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [r.originLon, r.originLat],
              [endLon, endLat],
            ],
          },
        };
      });

      // 3. Solar Shadow Azimuth Ray at Selected Hypothesis
      const selected = hypotheses.find((h) => h.id === selectedHypothesisId);
      const solarFeatures: Array<{
        type: 'Feature';
        properties: { role: string };
        geometry: { type: 'LineString'; coordinates: Array<[number, number]> };
      }> = [];
      if (selected?.solarCheck && selected.solarCheck.isDaylight) {
        const [shadLat, shadLon] = destinationPoint(
          selected.lat,
          selected.lon,
          selected.solarCheck.expectedShadowDirectionDeg,
          2.5
        );
        solarFeatures.push({
          type: 'Feature',
          properties: { role: 'expected_shadow' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [selected.lon, selected.lat],
              [shadLon, shadLat],
            ],
          },
        });
      }

      const upsertGeoJson = (
        id: string,
        data: Parameters<GeoJSONSource['setData']>[0]
      ) => {
        const src = map.getSource(id) as GeoJSONSource | undefined;
        if (src) {
          src.setData(data);
        } else {
          map.addSource(id, { type: 'geojson', data });
        }
      };

      upsertGeoJson('crimnex-measure-lines', {
        type: 'FeatureCollection',
        features: measureFeatures,
      });
      upsertGeoJson('crimnex-measure-pts', {
        type: 'FeatureCollection',
        features: measurePointFeatures,
      });
      upsertGeoJson('crimnex-rays', {
        type: 'FeatureCollection',
        features: rayFeatures,
      });
      upsertGeoJson('crimnex-solar', {
        type: 'FeatureCollection',
        features: solarFeatures,
      });

      if (!map.getLayer('crimnex-measure-lines-layer')) {
        map.addLayer({
          id: 'crimnex-measure-lines-layer',
          type: 'line',
          source: 'crimnex-measure-lines',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 2.2,
            'line-dasharray': [3, 2],
          },
        });
      }
      if (!map.getLayer('crimnex-measure-pts-layer')) {
        map.addLayer({
          id: 'crimnex-measure-pts-layer',
          type: 'circle',
          source: 'crimnex-measure-pts',
          paint: {
            'circle-radius': 4.5,
            'circle-color': '#f59e0b',
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#05070b',
          },
        });
      }
      if (!map.getLayer('crimnex-rays-layer')) {
        map.addLayer({
          id: 'crimnex-rays-layer',
          type: 'line',
          source: 'crimnex-rays',
          paint: {
            'line-color': '#38bdf8',
            'line-width': 2,
            'line-opacity': 0.85,
          },
        });
      }
      if (!map.getLayer('crimnex-solar-layer')) {
        map.addLayer({
          id: 'crimnex-solar-layer',
          type: 'line',
          source: 'crimnex-solar',
          paint: {
            'line-color': '#fde047',
            'line-width': 2.6,
            'line-dasharray': [2, 1.5],
          },
        });
      }
    }, [measurements, triangulationRays, hypotheses, selectedHypothesisId, styleRevision]);

    // Sync Hypothesis Markers + Triangulation Intersection Pin
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      for (const h of hypotheses) {
        const isSelected = h.id === selectedHypothesisId;
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute(
          'aria-label',
          `Hypothesis #${h.rank} ${h.nearestPlace?.name || ''}`
        );

        const bg =
          h.source === 'exif_gps'
            ? '#34d399'
            : h.source === 'manual_override' || h.verifiedByInvestigator
              ? '#f59e0b'
              : h.source === 'ocr_gazetteer'
                ? '#2dd4bf'
                : classification === 'inconclusive'
                  ? '#f87171'
                  : '#38bdf8';

        el.style.width = isSelected ? '32px' : '26px';
        el.style.height = isSelected ? '30px' : '24px';
        el.style.borderRadius = h.source === 'exif_gps' || h.source === 'ocr_gazetteer' ? '6px' : '999px';
        el.style.border = isSelected
          ? '2.5px solid #ffffff'
          : '1.5px solid rgba(5, 7, 11, 0.9)';
        el.style.background = bg;
        el.style.color = '#05070b';
        el.style.fontFamily = 'var(--font-mono)';
        el.style.fontWeight = '700';
        el.style.fontSize = h.source === 'ocr_gazetteer' ? '9.5px' : '11px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.cursor = 'pointer';
        el.style.boxShadow = isSelected
          ? `0 0 0 6px ${bg}33, 0 6px 18px rgba(0,0,0,0.6)`
          : '0 4px 12px rgba(0,0,0,0.45)';
        el.textContent =
          h.source === 'exif_gps'
            ? 'GPS'
            : h.source === 'manual_override'
              ? 'M'
              : h.source === 'ocr_gazetteer'
                ? 'OCR'
                : `${h.rank}`;

        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectHypothesis(h.id);
        });

        const marker = new Marker({ element: el })
          .setLngLat([h.lon, h.lat])
          .addTo(map);
        markersRef.current.push(marker);
      }

      if (triangulationIntersection) {
        const el = document.createElement('div');
        el.title = `Triangulation Intersection: ${formatCoordPair(
          triangulationIntersection.lat,
          triangulationIntersection.lon
        )}`;
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.borderRadius = '999px';
        el.style.background = '#fde047';
        el.style.border = '2px solid #05070b';
        el.style.boxShadow = '0 0 0 5px rgba(253, 224, 71, 0.28)';
        const interMarker = new Marker({ element: el })
          .setLngLat([triangulationIntersection.lon, triangulationIntersection.lat])
          .addTo(map);
        markersRef.current.push(interMarker);
      }

      if (pendingRayOrigin) {
        const el = document.createElement('div');
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.borderRadius = '999px';
        el.style.background = '#38bdf8';
        el.style.border = '2px solid #ffffff';
        const rayMarker = new Marker({ element: el })
          .setLngLat([pendingRayOrigin.lon, pendingRayOrigin.lat])
          .addTo(map);
        markersRef.current.push(rayMarker);
      }
    }, [hypotheses, selectedHypothesisId, classification, triangulationIntersection, pendingRayOrigin, onSelectHypothesis]);

    // Fly smoothly to selected hypothesis when selection changes
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !selectedHypothesisId) return;
      const target = hypotheses.find((h) => h.id === selectedHypothesisId);
      if (!target) return;

      const targetZoom =
        target.source === 'exif_gps' || target.source === 'manual_override'
          ? 14
          : target.clusterRadiusKm < 10
            ? 12.2
            : 10.2;

      map.flyTo({
        center: [target.lon, target.lat],
        zoom: targetZoom,
        duration: capabilities.reducedMotion ? 0 : 1250,
        essential: true,
      });
    }, [selectedHypothesisId, hypotheses, capabilities.reducedMotion]);

    if (!capabilities.webgl || webglCrashed) {
      return (
        <SvgMapFallback
          hypotheses={hypotheses}
          selectedHypothesisId={selectedHypothesisId}
          onSelectHypothesis={onSelectHypothesis}
          onSetManualPin={onSetManualPin}
          mode={mode}
          lang={lang}
        />
      );
    }

    const activeMeasurement = measurements[0];

    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          background: '#05070b',
        }}
      >
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            cursor: mode === 'inspect' ? 'grab' : 'crosshair',
          }}
        />

        {/* Top Map Controls Toolbar */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            right: 12,
            zIndex: 10,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            pointerEvents: 'none',
          }}
        >
          {/* Left Tool Group */}
          <div
            style={{
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(9, 13, 21, 0.88)',
              border: '1px solid var(--border-hairline)',
              backdropFilter: 'blur(12px)',
              pointerEvents: 'auto',
            }}
          >
            <button
              type="button"
              className={`btn-ghost ${mode === 'inspect' ? 'active' : ''}`}
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: mode === 'inspect' ? 'var(--accent-cyan)' : undefined,
                background: mode === 'inspect' ? 'var(--accent-cyan-soft)' : undefined,
              }}
              onClick={() => {
                setPendingRayOrigin(null);
                onModeChange('inspect');
              }}
            >
              <Crosshair size={13} />
              <span>{pt ? 'Explorar' : 'Explore'}</span>
            </button>

            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: mode === 'manual_pin' ? 'var(--accent-amber)' : undefined,
                background: mode === 'manual_pin' ? 'var(--accent-amber-soft)' : undefined,
              }}
              onClick={() => {
                setPendingRayOrigin(null);
                onModeChange(mode === 'manual_pin' ? 'inspect' : 'manual_pin');
              }}
            >
              <MapPin size={13} />
              <span>{t.workspace.manualPinMode}</span>
            </button>

            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: mode === 'measure' ? 'var(--accent-amber)' : undefined,
                background: mode === 'measure' ? 'var(--accent-amber-soft)' : undefined,
              }}
              onClick={() => {
                setPendingRayOrigin(null);
                onModeChange(mode === 'measure' ? 'inspect' : 'measure');
              }}
            >
              <Ruler size={13} />
              <span>{t.workspace.measureMode}</span>
            </button>

            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: mode === 'bearing_ray' ? 'var(--accent-cyan)' : undefined,
                background: mode === 'bearing_ray' ? 'var(--accent-cyan-soft)' : undefined,
              }}
              onClick={() => {
                setPendingRayOrigin(null);
                onModeChange(mode === 'bearing_ray' ? 'inspect' : 'bearing_ray');
              }}
            >
              <Compass size={13} />
              <span>{t.workspace.rayMode}</span>
            </button>
          </div>

          {/* Right Layer / Projection Switcher */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: 4,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(9, 13, 21, 0.88)',
              border: '1px solid var(--border-hairline)',
              backdropFilter: 'blur(12px)',
              pointerEvents: 'auto',
            }}
          >
            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: theme === 'obsidian' ? 'var(--ink-primary)' : 'var(--ink-muted)',
                background: theme === 'obsidian' ? 'rgba(255,255,255,0.08)' : undefined,
              }}
              onClick={() => handleThemeSwitch('obsidian')}
            >
              {t.workspace.mapThemeObsidian}
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 9px',
                fontSize: 12,
                color: theme === 'liberty' ? 'var(--ink-primary)' : 'var(--ink-muted)',
                background: theme === 'liberty' ? 'rgba(255,255,255,0.08)' : undefined,
              }}
              onClick={() => handleThemeSwitch('liberty')}
            >
              {t.workspace.mapThemeLiberty}
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 8px',
                fontSize: 12,
                color: useGlobe ? 'var(--accent-cyan)' : undefined,
                background: useGlobe ? 'var(--accent-cyan-soft)' : undefined,
              }}
              onClick={() => setUseGlobe((g) => !g)}
              title={t.workspace.globeView}
            >
              <Globe size={13} />
            </button>
            <button
              type="button"
              className="btn-ghost"
              style={{
                padding: '5px 8px',
                fontSize: 12,
                color: useTerrain ? 'var(--accent-emerald)' : undefined,
                background: useTerrain ? 'var(--accent-emerald-soft)' : undefined,
              }}
              onClick={() => setUseTerrain((v) => !v)}
              title={t.workspace.terrain3d}
            >
              <Mountain size={13} />
            </button>
          </div>
        </div>

        {/* Contextual Helper Strip for Offline Fallback / Measurement / Bearing Ray */}
        {(offlineNotice || mode !== 'inspect' || (activeMeasurement && activeMeasurement.points.length > 0)) && (
          <div
            style={{
              position: 'absolute',
              top: 64,
              left: 12,
              zIndex: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              maxWidth: 410,
            }}
          >
            {offlineNotice && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(11, 15, 23, 0.92)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: 'var(--accent-amber)',
                  fontSize: 12,
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{t.workspace.mapOfflineBanner}</span>
              </div>
            )}

            {mode === 'manual_pin' && (
              <div
                className="mono"
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(11, 15, 23, 0.92)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: 'var(--accent-amber)',
                  fontSize: 11.5,
                }}
              >
                {pt
                  ? 'Clique no mapa para definir manualmente o local exato.'
                  : 'Click anywhere on the map to place a manual verified pin.'}
              </div>
            )}

            {mode === 'bearing_ray' && (
              <div
                className="mono"
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(11, 15, 23, 0.92)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: 'var(--accent-cyan)',
                  fontSize: 11.5,
                }}
              >
                {pendingRayOrigin
                  ? pt
                    ? 'Passo 2: clique na direção da visada para traçar o azimute.'
                    : 'Step 2: click along the sightline direction to lock bearing ray.'
                  : pt
                    ? 'Passo 1: clique no ponto de origem (ex.: monumento ou antena visível).'
                    : 'Step 1: click an origin landmark to start a triangulation ray.'}
              </div>
            )}

            {(mode === 'measure' || (activeMeasurement && activeMeasurement.points.length > 0)) && (
              <div
                className="mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'rgba(11, 15, 23, 0.92)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  color: 'var(--ink-primary)',
                  fontSize: 11.5,
                }}
              >
                <span>
                  {activeMeasurement && activeMeasurement.points.length >= 2
                    ? `${activeMeasurement.totalKm.toFixed(2)} km (${(activeMeasurement.totalKm * 1000).toFixed(0)} m) · ${activeMeasurement.bearingDeg}°`
                    : pt
                      ? 'Clique em 2+ pontos no mapa para medir.'
                      : 'Click 2+ points on the map to measure distance.'}
                </span>
                {activeMeasurement && activeMeasurement.points.length > 0 && (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ padding: 2, color: 'var(--accent-coral)' }}
                    aria-label="Clear measurements"
                    onClick={() => onUpdateMeasurements([])}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Cursor Coordinate Readout HUD */}
        {cursorCoords && (
          <div
            className="mono"
            style={{
              position: 'absolute',
              bottom: 34,
              left: 12,
              zIndex: 8,
              padding: '4px 9px',
              borderRadius: 'var(--radius-xs)',
              background: 'rgba(8, 11, 18, 0.85)',
              border: '1px solid var(--border-hairline)',
              color: 'var(--ink-secondary)',
              fontSize: 11,
              pointerEvents: 'none',
            }}
          >
            {formatCoordPair(cursorCoords.lat, cursorCoords.lon)}
          </div>
        )}
      </div>
    );
  }
);

MapWorkspace.displayName = 'MapWorkspace';
