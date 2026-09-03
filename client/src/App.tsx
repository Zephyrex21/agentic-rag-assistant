import { lazy, Suspense, useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { DocumentsProvider } from './context/DocumentsContext';
import { ConversationsProvider } from './context/ConversationsContext';
import { Hero } from './components/hero/Hero';
import { GrainOverlay } from './components/GrainOverlay';
import { AmbientBackground } from './components/AmbientBackground';
import { ColdStartNotice } from './components/ColdStartNotice';
import { AccessKeyGate } from './components/AccessKeyGate';
import { GuestLimitGate } from './components/GuestLimitGate';
import { OAuthCallbackHandler } from './components/OAuthCallbackHandler';
import { LogoMark } from './components/LogoMark';

// Split out of the initial bundle - see MainAppView.tsx for why. The
// landing page (Hero, above) stays eager since it's the very first thing
// anyone sees; everything markdown/command-palette/panel-related only
// loads once someone actually clicks in.
const MainAppView = lazy(() => import('./MainAppView'));

type View = 'hero' | 'app';

// Persisted in sessionStorage (not localStorage) specifically so a reload
// - which both AuthContext's verifyOtp (sign-in) and logout trigger
// deliberately, see their own comments - lands back wherever the person
// actually was, not always back at the landing page. sessionStorage
// (rather than localStorage) is the right scope for this: it survives a
// reload within the same tab, which is all this needs, but still resets
// for a genuinely fresh visit in a new tab - the hero page staying the
// default first-ever experience is intentional, this is only about not
// undoing "I already clicked Enter the assistant" out from under someone
// via a reload they didn't initiate themselves.
const VIEW_STORAGE_KEY = 'rag_view';

function getInitialView(): View {
  try {
    return sessionStorage.getItem(VIEW_STORAGE_KEY) === 'app' ? 'app' : 'hero';
  } catch {
    return 'hero'; // sessionStorage can throw in some locked-down/private-browsing contexts
  }
}

function persistView(view: View) {
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Non-fatal - the view just won't survive a reload in this context
  }
}

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
  const [view, setViewState] = useState<View>(getInitialView);

  const setView = (next: View) => {
    setViewState(next);
    persistView(next);
  };

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
        <AuthProvider>
          <DocumentsProvider>
            <ConversationsProvider>
              <AmbientBackground />
              <GrainOverlay />
              <ColdStartNotice />
              <AccessKeyGate />
              <GuestLimitGate />
              <OAuthCallbackHandler />
              <AppContent />
            </ConversationsProvider>
          </DocumentsProvider>
        </AuthProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
