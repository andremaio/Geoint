import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { GlobeHero } from './GlobeHero';
import { TRANSLATIONS } from '../i18n/translations';
import type { Language, RuntimeCapabilities } from '../types/geoint';
import type { AppRoute } from './NavigationHeader';

interface HeroLandingProps {
  lang: Language;
  capabilities: RuntimeCapabilities;
  transitioning: boolean;
  onStartAnalyze: () => void;
  onNavigate: (route: AppRoute) => void;
}

export const HeroLanding: React.FC<HeroLandingProps> = ({
  lang,
  capabilities,
  transitioning,
  onStartAnalyze,
  onNavigate,
}) => {
  const t = TRANSLATIONS[lang];
  const [activeTarget, setActiveTarget] = useState({
    label: 'LISBON · PT',
    lat: 38.6916,
    lon: -9.216,
  });

  return (
    <section className="hero-shell">
      <div className="hero-globe-layer">
        <GlobeHero
          capabilities={capabilities}
          transitioning={transitioning}
          onActiveTargetChange={setActiveTarget}
        />
      </div>

      <div className="hero-vignette" />

      <motion.div
        className="hero-content"
        initial={capabilities.reducedMotion ? false : { opacity: 0, y: 16 }}
        animate={
          transitioning
            ? { opacity: 0, y: -12 }
            : { opacity: 1, y: 0 }
        }
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <p className="hero-eyebrow">{t.hero.telemetryMode}</p>
        <h1 className="hero-title">{t.hero.title}</h1>
        <p className="hero-subtitle">{t.hero.subtitle}</p>

        <button
          id="hero-analyze-btn"
          type="button"
          className="btn-primary"
          onClick={onStartAnalyze}
          disabled={transitioning}
        >
          <span>{t.hero.cta}</span>
          <ArrowRight size={17} strokeWidth={2.2} />
        </button>
      </motion.div>

      <footer className="hero-telemetry-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span>
            TARGET VECTOR:{' '}
            <strong style={{ color: 'var(--ink-secondary)', fontWeight: 500 }}>
              {activeTarget.label}
            </strong>
          </span>
          <span>
            {activeTarget.lat.toFixed(4)}°, {activeTarget.lon.toFixed(4)}°
          </span>
          {!capabilities.webgl && <span>{t.hero.webglFallbackNote}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 0, fontSize: 11.5 }}
            onClick={() => onNavigate('methodology')}
          >
            {t.nav.methodology}
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 0, fontSize: 11.5 }}
            onClick={() => onNavigate('privacy')}
          >
            {t.nav.privacy}
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 0, fontSize: 11.5 }}
            onClick={() => onNavigate('terms')}
          >
            {t.nav.terms}
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ padding: 0, fontSize: 11.5 }}
            onClick={() => onNavigate('credits')}
          >
            {t.nav.credits}
          </button>
        </div>
      </footer>
    </section>
  );
};
