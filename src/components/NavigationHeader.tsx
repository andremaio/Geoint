import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { TRANSLATIONS } from '../i18n/translations';
import type { Language } from '../types/geoint';

export type AppRoute = 'home' | 'analyze' | 'methodology' | 'privacy' | 'terms' | 'credits';

interface NavigationHeaderProps {
  route: AppRoute;
  lang: Language;
  onNavigate: (route: AppRoute) => void;
  onChangeLang: (lang: Language) => void;
}

export const NavigationHeader: React.FC<NavigationHeaderProps> = ({
  route,
  lang,
  onNavigate,
  onChangeLang,
}) => {
  const t = TRANSLATIONS[lang];
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: Array<{ id: AppRoute; label: string }> = [
    { id: 'analyze', label: t.nav.workspace },
    { id: 'methodology', label: t.nav.methodology },
    { id: 'privacy', label: t.nav.privacy },
    { id: 'credits', label: t.nav.credits },
  ];

  const handleSelect = (r: AppRoute) => {
    setMobileOpen(false);
    onNavigate(r);
  };

  return (
    <header className="site-header">
      <button
        type="button"
        className="header-brand"
        onClick={() => handleSelect('home')}
        aria-label="CRIMNEX GEOINT Home"
      >
        <BrandMark size={26} compact />
      </button>

      <nav className="header-nav" aria-label="Primary Navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-link nav-hide-mobile ${route === item.id ? 'active' : ''}`}
            onClick={() => handleSelect(item.id)}
          >
            {item.label}
          </button>
        ))}

        <div className="lang-toggle" role="group" aria-label="Language switch">
          <button
            type="button"
            className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
            onClick={() => onChangeLang('en')}
            aria-pressed={lang === 'en'}
          >
            EN
          </button>
          <button
            type="button"
            className={`lang-btn ${lang === 'pt-PT' ? 'active' : ''}`}
            onClick={() => onChangeLang('pt-PT')}
            aria-pressed={lang === 'pt-PT'}
          >
            PT
          </button>
        </div>

        <button
          type="button"
          className="btn-ghost mobile-nav-btn"
          aria-label="Toggle Menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {mobileOpen && (
        <div
          style={{
            position: 'fixed',
            top: 64,
            left: 0,
            right: 0,
            background: 'rgba(8, 11, 18, 0.97)',
            backdropFilter: 'blur(20px)',
            borderBottom: '1px solid var(--border-hairline)',
            padding: '12px 20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            zIndex: 50,
          }}
        >
          <button
            type="button"
            className={`nav-link ${route === 'home' ? 'active' : ''}`}
            style={{ textAlign: 'left' }}
            onClick={() => handleSelect('home')}
          >
            {t.nav.backHome}
          </button>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-link ${route === item.id ? 'active' : ''}`}
              style={{ textAlign: 'left' }}
              onClick={() => handleSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className={`nav-link ${route === 'terms' ? 'active' : ''}`}
            style={{ textAlign: 'left' }}
            onClick={() => handleSelect('terms')}
          >
            {t.nav.terms}
          </button>
        </div>
      )}
    </header>
  );
};
