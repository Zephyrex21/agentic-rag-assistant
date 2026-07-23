import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { LogoMark } from '../LogoMark';

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

export function Hero({ onEnter }: { onEnter: () => void }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      {/* Ambient breathing gradient orb - the "thinking" motif, kept subtle */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-[110px]"
          style={{
            background: 'radial-gradient(circle, var(--accent) 0%, var(--highlight) 55%, transparent 75%)',
          }}
          animate={
            reduceMotion
              ? {}
              : { scale: [1, 1.12, 1], opacity: [0.14, 0.22, 0.14] }
          }
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

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
          Gemini · Pinecone · Supabase
        </p>
      </footer>
    </div>
  );
}
