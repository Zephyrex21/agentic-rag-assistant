import { motion, useReducedMotion, useMotionValue, useSpring, useTransform, type Variants } from 'framer-motion';
import { useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { LogoMark } from '../LogoMark';
import { SignalBackground } from './signal-field/SignalBackground';

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

/** Small floating tags echoing the citation-stamp motif used throughout the
 * app - the landing page's signature element should match the product's,
 * not just be generic decoration. Each drifts independently and very
 * slowly; positions are spread out so they read as ambient atmosphere,
 * not competing with the headline for attention. */
function FloatingStamp({
  label,
  className,
  delay,
  duration,
}: {
  label: string;
  className: string;
  delay: number;
  duration: number;
}) {
  return (
    <motion.div
      className={`pointer-events-none absolute hidden select-none items-center justify-center rounded-[3px] px-2 py-1 font-mono text-[10px] font-semibold sm:flex ${className}`}
      style={{
        background: 'color-mix(in srgb, var(--highlight) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--highlight) 35%, transparent)',
        color: 'var(--highlight)',
      }}
      initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
      animate={{
        opacity: [0, 0.8, 0.8, 0],
        scale: 1,
        rotate: [-12, -6, -12],
        y: [0, -14, 0],
      }}
      transition={{ opacity: { duration, delay, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 0.5, delay }, rotate: { duration, delay, repeat: Infinity, ease: 'easeInOut' }, y: { duration, delay, repeat: Infinity, ease: 'easeInOut' } }}
    >
      {label}
    </motion.div>
  );
}

export function Hero({ onEnter }: { onEnter: () => void }) {
  const reduceMotion = useReducedMotion();

  // Cursor-parallax on the ambient orb - subtle depth cue, disabled
  // entirely under reduced-motion rather than just skipping the spring.
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, { stiffness: 40, damping: 20 });
  const springY = useSpring(mouseY, { stiffness: 40, damping: 20 });
  const orbX = useTransform(springX, [-0.5, 0.5], ['-4%', '4%']);
  const orbY = useTransform(springY, [-0.5, 0.5], ['-4%', '4%']);

  useEffect(() => {
    if (reduceMotion) return;
    const handleMove = (e: MouseEvent) => {
      mouseX.set(e.clientX / window.innerWidth - 0.5);
      mouseY.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, [reduceMotion, mouseX, mouseY]);

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      {/* "The Array" - a 3D signal-field background (see signal-field/) that
          falls back to the original 2D orb under reduced-motion, no WebGL,
          or any runtime error. Hero-only, deliberately - see
          signal-field/SignalFieldScene.tsx's header comment. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <SignalBackground reduceMotion={Boolean(reduceMotion)} orbX={orbX} orbY={orbY} />
        {/* Inverse vignette - fades the 3D scene's density right behind the
            headline/CTA specifically, so the richest part of the visual
            sits at the edges while the text stays on a calm, legible
            surface. A CSS overlay is far simpler and more reliable than
            trying to keep 3D particles/terrain out of a screen-space
            region as the viewport resizes. */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 60% 45% at 50% 42%, var(--bg) 0%, transparent 70%)' }}
        />
      </div>

      {!reduceMotion && (
        <>
          <FloatingStamp label="1" className="left-[12%] top-[28%]" delay={0} duration={9} />
          <FloatingStamp label="2" className="right-[14%] top-[38%]" delay={1.4} duration={11} />
          <FloatingStamp label="3" className="left-[18%] bottom-[24%]" delay={2.8} duration={10} />
        </>
      )}

      <header className="relative z-10 flex items-center justify-between px-6 py-6 sm:px-10">
        <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
          <LogoMark size={18} />
          RAG Assistant
        </span>
        <ThemeToggle />
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex max-w-2xl flex-col items-center gap-6"
        >
          <motion.span
            variants={item}
            className="font-mono text-xs uppercase tracking-[0.2em] text-accent"
          >
            Agentic · Grounded · Cited
          </motion.span>

          <motion.h1
            variants={item}
            className="font-serif text-5xl leading-[1.08] tracking-tight text-ink sm:text-6xl"
          >
            Ask your documents anything.
          </motion.h1>

          <motion.p
            variants={item}
            className="max-w-md text-balance text-lg leading-relaxed text-ink-muted"
          >
            Every answer traces back to its source — no guessing, no black box.
            Upload a document, start a conversation.
          </motion.p>

          <motion.div variants={item}>
            <motion.button
              type="button"
              onClick={onEnter}
              whileHover={reduceMotion ? {} : { scale: 1.03, y: -1 }}
              whileTap={reduceMotion ? {} : { scale: 0.97, y: 0 }}
              className="group mt-2 flex items-center gap-2 rounded-full px-6 py-3 font-medium text-accent-ink cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
                boxShadow: '0 1px 0 0 rgba(255,255,255,0.15) inset, 0 8px 24px -8px var(--accent)',
              }}
            >
              Enter the assistant
              <ArrowRight
                size={18}
                className="transition-transform duration-300 group-hover:translate-x-1"
              />
            </motion.button>
          </motion.div>
        </motion.div>
      </main>

      <footer className="relative z-10 pb-8 text-center">
        <p className="font-mono text-[11px] text-ink-muted/70">
          Groq · Jina AI · Pinecone · Supabase
        </p>
      </footer>
    </div>
  );
}
