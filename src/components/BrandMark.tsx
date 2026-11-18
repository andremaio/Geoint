import React from 'react';

interface BrandMarkProps {
  size?: number;
  showWordmark?: boolean;
  compact?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 28,
  showWordmark = true,
  compact = false,
}) => {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: compact ? 8 : 11 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle
          cx="18"
          cy="18"
          r="15"
          stroke="rgba(243, 245, 248, 0.24)"
          strokeWidth="1.2"
        />
        <ellipse
          cx="18"
          cy="18"
          rx="7.5"
          ry="15"
          stroke="rgba(243, 245, 248, 0.2)"
          strokeWidth="1"
        />
        <line
          x1="3"
          y1="18"
          x2="11"
          y2="18"
          stroke="#F3F5F8"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="25"
          y1="18"
          x2="33"
          y2="18"
          stroke="#F3F5F8"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="18"
          y1="3"
          x2="18"
          y2="11"
          stroke="#F3F5F8"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <line
          x1="18"
          y1="25"
          x2="18"
          y2="33"
          stroke="#F3F5F8"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <circle cx="18" cy="18" r="3.2" fill="#38BDF8" />
        <circle cx="18" cy="18" r="6.5" stroke="#38BDF8" strokeOpacity="0.45" strokeWidth="1" />
      </svg>
      {showWordmark && (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: compact ? '14px' : '15.5px',
              letterSpacing: '0.08em',
              color: 'var(--ink-primary)',
            }}
          >
            CRIMNEX
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: compact ? '11px' : '11.5px',
              letterSpacing: '0.14em',
              color: 'var(--accent-cyan)',
            }}
          >
            GEOINT
          </span>
        </span>
      )}
    </span>
  );
};
