import { lazy, Suspense, useEffect, useState } from 'react';
import { motion, type MotionValue } from 'framer-motion';
import { SceneErrorBoundary } from './SceneErrorBoundary';

const SignalFieldScene = lazy(() =>
  import('./SignalFieldScene').then((mod) => ({ default: mod.SignalFieldScene }))
);

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

/** The original 2D gradient orb - kept as the fallback for reduced-motion,
 * no-WebGL, and any 3D scene failure (see SceneErrorBoundary), and as
 * what's shown while the 3D scene's chunk is still being fetched. */
function GradientOrbFallback({
  reduceMotion,
  orbX,
  orbY,
}: {
  reduceMotion: boolean;
  orbX: MotionValue<string> | number;
  orbY: MotionValue<string> | number;
}) {
  return (
    <motion.div
      className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-[110px]"
      style={{
        background: 'radial-gradient(circle, var(--accent) 0%, var(--highlight) 55%, transparent 75%)',
        x: reduceMotion ? 0 : orbX,
        y: reduceMotion ? 0 : orbY,
      }}
      animate={reduceMotion ? {} : { scale: [1, 1.12, 1], opacity: [0.14, 0.22, 0.14] }}
      transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

/**
 * "The Array" - the Hero-only 3D background (see SignalFieldScene.tsx for
 * the actual scene). This wrapper is what makes it safe to ship: reduced-
 * motion and no-WebGL skip loading the 3D chunk entirely (falls back to
 * the plain 2D orb, no wasted fetch), any runtime failure degrades the
 * same way via SceneErrorBoundary, and the scene pauses its render loop
 * whenever the tab isn't visible.
 */
export function SignalBackground({
  theme,
  reduceMotion,
  orbX,
  orbY,
}: {
  theme: 'light' | 'dark';
  reduceMotion: boolean;
  orbX: MotionValue<string> | number;
  orbY: MotionValue<string> | number;
}) {
  const [webglOk, setWebglOk] = useState(true);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setWebglOk(supportsWebGL());
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const fallback = <GradientOrbFallback reduceMotion={reduceMotion} orbX={orbX} orbY={orbY} />;

  if (reduceMotion || !webglOk) {
    return fallback;
  }

  return (
    <SceneErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <SignalFieldScene theme={theme} reduceMotion={reduceMotion} paused={hidden} />
      </Suspense>
    </SceneErrorBoundary>
  );
}
