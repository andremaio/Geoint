import React, { useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Copy, Check, Compass } from 'lucide-react';
import type { Language, ValidationResult } from '../types/geoint';

interface ImageEvidenceViewerProps {
  imageUrl: string;
  validation: ValidationResult;
  lang: Language;
  observedShadowAzimuthDeg?: number;
  compact?: boolean;
}

export const ImageEvidenceViewer: React.FC<ImageEvidenceViewerProps> = ({
  imageUrl,
  validation,
  lang,
  observedShadowAzimuthDeg,
  compact = false,
}) => {
  const pt = lang === 'pt-PT';
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const dragState = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const handleCopyHash = async () => {
    try {
      await navigator.clipboard.writeText(validation.sha256);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      // ignore clipboard blocked
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    setZoom((z) => {
      const next = Math.max(1, Math.min(5, Number((z + delta).toFixed(2))));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current.active) return;
    setPan({
      x: dragState.current.origX + (e.clientX - dragState.current.startX),
      y: dragState.current.origY + (e.clientY - dragState.current.startY),
    });
  };

  const onPointerUp = () => {
    dragState.current.active = false;
    setIsDragging(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border-hairline)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        background: '#05080e',
      }}
    >
      {/* Image Canvas Viewport */}
      <div
        onWheel={handleWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          height: compact ? 240 : 250,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 50% 50%, rgba(30,41,59,0.22) 0%, rgba(5,7,11,1) 100%)',
          cursor: zoom > 1 ? 'grab' : 'default',
          touchAction: zoom > 1 ? 'none' : 'pan-y',
        }}
      >
        <img
          src={imageUrl}
          alt={validation.fileName}
          draggable={false}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            userSelect: 'none',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transition: isDragging ? 'none' : 'transform 0.14s ease-out',
          }}
        />

        {/* Zoom Controls HUD */}
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            padding: 3,
            borderRadius: 'var(--radius-xs)',
            background: 'rgba(8, 12, 20, 0.85)',
            border: '1px solid var(--border-hairline)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '4px 6px' }}
            aria-label={pt ? 'Reduzir zoom' : 'Zoom out'}
            onClick={() =>
              setZoom((z) => {
                const next = Math.max(1, Number((z - 0.5).toFixed(1)));
                if (next === 1) setPan({ x: 0, y: 0 });
                return next;
              })
            }
          >
            <ZoomOut size={13} />
          </button>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-secondary)', padding: '0 4px' }}>
            {zoom.toFixed(1)}x
          </span>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: '4px 6px' }}
            aria-label={pt ? 'Ampliar zoom' : 'Zoom in'}
            onClick={() => setZoom((z) => Math.min(5, Number((z + 0.5).toFixed(1))))}
          >
            <ZoomIn size={13} />
          </button>
          {zoom > 1 && (
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: '4px 6px' }}
              aria-label={pt ? 'Repor vista' : 'Reset zoom'}
              onClick={resetView}
            >
              <RotateCcw size={13} />
            </button>
          )}
        </div>

        {/* Optional Observed Shadow Indicator */}
        {typeof observedShadowAzimuthDeg === 'number' && (
          <div
            className="mono"
            style={{
              position: 'absolute',
              bottom: 10,
              left: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 8px',
              fontSize: 11,
              color: 'var(--accent-amber)',
              background: 'rgba(8, 12, 20, 0.86)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            <Compass size={12} />
            <span>
              {pt ? 'Sombra observada:' : 'Observed shadow:'} {observedShadowAzimuthDeg}°
            </span>
          </div>
        )}
      </div>

      {/* Integrity Footer Bar */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-hairline)',
          background: 'rgba(11, 15, 23, 0.92)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 11.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontWeight: 600,
              color: 'var(--ink-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 165,
            }}
            title={validation.fileName}
          >
            {validation.fileName}
          </span>
          <span className="mono" style={{ color: 'var(--ink-muted)', fontSize: 11 }}>
            {validation.width}×{validation.height} · {(validation.fileSizeBytes / 1024).toFixed(0)} KB
          </span>
        </div>

        <button
          type="button"
          className="btn-ghost mono"
          onClick={handleCopyHash}
          title={validation.sha256}
          style={{ padding: '2px 6px', fontSize: 10.5, color: 'var(--ink-secondary)' }}
        >
          <span>SHA-256: {validation.sha256.slice(0, 12)}…</span>
          {copiedHash ? <Check size={11} color="#34d399" /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  );
};
