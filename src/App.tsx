import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { HeroLanding } from './components/HeroLanding';
import { NavigationHeader, type AppRoute } from './components/NavigationHeader';
import { detectRuntimeCapabilities } from './engine/diagnostics';
import type { Language } from './types/geoint';

const AnalysisWorkspace = React.lazy(() =>
  import('./components/AnalysisWorkspace').then((m) => ({
    default: m.AnalysisWorkspace,
  }))
);

const LegalPage = React.lazy(() =>
  import('./pages/LegalPages').then((m) => ({
    default: m.LegalPage,
  }))
);

function parseRouteFromPath(pathname: string): AppRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/analyze') return 'analyze';
  if (clean === '/methodology') return 'methodology';
  if (clean === '/privacy') return 'privacy';
  if (clean === '/terms') return 'terms';
  if (clean === '/credits') return 'credits';
  return 'home';
}

function routeToPath(route: AppRoute): string {
  return route === 'home' ? '/' : `/${route}`;
}

const WorkspaceFallbackLoader: React.FC<{ lang: Language }> = ({ lang }) => (
  <div
    style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--ink-secondary)',
      fontFamily: 'var(--font-mono)',
      fontSize: 12.5,
      letterSpacing: '0.08em',
    }}
  >
    {lang === 'pt-PT' ? 'A INICIALIZAR AMBIENTE GEOESPACIAL…' : 'INITIALIZING GEOSPATIAL WORKBENCH…'}
  </div>
);

export function App() {
  const capabilities = useMemo(() => detectRuntimeCapabilities(), []);
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? parseRouteFromPath(window.location.pathname) : 'home'
  );
  const [lang, setLang] = useState<Language>(() => {
    if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('pt')) {
      return 'pt-PT';
    }
    return 'en';
  });
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRouteFromPath(window.location.pathname));
      setTransitioning(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = useCallback((nextRoute: AppRoute) => {
    const targetPath = routeToPath(nextRoute);
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const handleStartAnalyze = useCallback(() => {
    // Pre-warm lazy workspace bundle immediately while globe zooms seamlessly
    void import('./components/AnalysisWorkspace');
    if (capabilities.reducedMotion) {
      navigateTo('analyze');
      return;
    }
    setTransitioning(true);
    window.setTimeout(() => {
      navigateTo('analyze');
      setTransitioning(false);
    }, 460);
  }, [capabilities.reducedMotion, navigateTo]);

  return (
    <MotionConfig reducedMotion="user">
      <NavigationHeader
        route={route}
        lang={lang}
        onNavigate={navigateTo}
        onChangeLang={setLang}
      />

      <AnimatePresence mode="wait">
        {route === 'home' && (
          <motion.main
            key="route-home"
            initial={false}
            exit={capabilities.reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <HeroLanding
              lang={lang}
              capabilities={capabilities}
              transitioning={transitioning}
              onStartAnalyze={handleStartAnalyze}
              onNavigate={navigateTo}
            />
          </motion.main>
        )}

        {route === 'analyze' && (
          <motion.main
            key="route-analyze"
            initial={capabilities.reducedMotion ? false : { opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={capabilities.reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          >
            <Suspense fallback={<WorkspaceFallbackLoader lang={lang} />}>
              <AnalysisWorkspace lang={lang} capabilities={capabilities} />
            </Suspense>
          </motion.main>
        )}

        {(route === 'methodology' ||
          route === 'privacy' ||
          route === 'terms' ||
          route === 'credits') && (
          <motion.div
            key={`route-${route}`}
            initial={capabilities.reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={capabilities.reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Suspense fallback={<WorkspaceFallbackLoader lang={lang} />}>
              <LegalPage route={route} lang={lang} onNavigate={navigateTo} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

export default App;
