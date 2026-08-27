import { lazy, Suspense, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { DocumentsProvider } from './context/DocumentsContext';
import { ConversationsProvider } from './context/ConversationsContext';
import { Hero } from './components/hero/Hero';
import { GrainOverlay } from './components/GrainOverlay';
import { AmbientBackground } from './components/AmbientBackground';
import { ColdStartNotice } from './components/ColdStartNotice';
import { AccessKeyGate } from './components/AccessKeyGate';
import { LogoMark } from './components/LogoMark';

// Split out of the initial bundle - see MainAppView.tsx for why. The
// landing page (Hero, above) stays eager since it's the very first thing
// anyone sees; everything markdown/command-palette/panel-related only
// loads once someone actually clicks in.
const MainAppView = lazy(() => import('./MainAppView'));

type View = 'hero' | 'app';

function LoadingFallback() {
  // Deliberately minimal and quick, not a branded splash screen - this
  // only shows for the brief moment the lazy chunk is fetching, which on
  // any reasonable connection is well under a second. Uses the actual
  // LogoMark (rather than a generic spinner) so even this brief moment
  // reads as "the app," not a placeholder - a soft pulse rather than a
  // spin, since a mark pulsing gently reads as "warming up" without
  // implying a specific duration the way a rotating ring does.
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <motion.div
        animate={{ opacity: [0.4, 1, 0.4], scale: [0.94, 1, 0.94] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <LogoMark size={32} />
      </motion.div>
    </div>
  );
}

function AppContent() {
  const [view, setView] = useState<View>('hero');

  return (
    <AnimatePresence mode="wait">
      {view === 'hero' ? (
        <motion.div key="hero" exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          <Hero onEnter={() => setView('app')} />
        </motion.div>
      ) : (
        <Suspense fallback={<LoadingFallback />}>
          <MainAppView onGoHome={() => setView('hero')} />
        </Suspense>
      )}
    </AnimatePresence>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <DocumentsProvider>
          <ConversationsProvider>
            <AmbientBackground />
            <GrainOverlay />
            <ColdStartNotice />
            <AccessKeyGate />
            <AppContent />
          </ConversationsProvider>
        </DocumentsProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
