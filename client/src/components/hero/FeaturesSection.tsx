import { motion, useReducedMotion, type Variants } from 'framer-motion';
import { Bot, GitMerge, SlidersHorizontal, ShieldCheck, Quote, Activity } from 'lucide-react';

interface Feature {
  icon: typeof Bot;
  title: string;
  description: string;
}

const FEATURES: Feature[] = [
  {
    icon: Bot,
    title: 'Agentic retrieval planning',
    description:
      "A tool-calling planner decides for itself whether a question needs searching at all, and how many times — not a fixed one-search-per-question pipeline.",
  },
  {
    icon: GitMerge,
    title: 'Hybrid search + RRF fusion',
    description:
      'Vector similarity and keyword search run in parallel and get merged with Reciprocal Rank Fusion, so exact terms never lose out to semantic drift.',
  },
  {
    icon: SlidersHorizontal,
    title: 'LLM reranking',
    description:
      'Every fused candidate is re-judged for genuine relevance in a single batched call before it ever reaches the model that writes your answer.',
  },
  {
    icon: ShieldCheck,
    title: 'Self-verification',
    description:
      "A background pass checks whether the answer is actually supported by its sources, and offers a corrected, re-searched revision when it isn't.",
  },
  {
    icon: Quote,
    title: 'Verifiable citations',
    description:
      'Every claim links back to an exact source chunk. Sources that were cited versus merely retrieved are always shown separately, never blended.',
  },
  {
    icon: Activity,
    title: 'Pipeline observability',
    description:
      'A stage-by-stage trace of retrieval, fusion, reranking, and verification — inspectable per answer, not buried in a server log.',
  },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

/**
 * The landing page's "how it works" section, sitting directly below the
 * hero fold (see Hero.tsx). Exists because the hero itself is deliberately
 * spare — one headline, one CTA — so the actual technical depth of the
 * pipeline (hybrid search, reranking, self-verification, etc.) needed
 * somewhere to live for anyone who scrolls past "Enter the assistant"
 * wanting to know what they're actually getting.
 */
export function FeaturesSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section className="relative border-t border-border bg-background px-6 py-20 sm:px-10 sm:py-28">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={reduceMotion ? undefined : { opacity: 0, y: 16 }}
          whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto max-w-xl text-center"
        >
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Under the hood</span>
          <h2 className="mt-3 font-serif text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
            Engineered, not just prompted.
          </h2>
          <p className="mt-3 text-balance text-[15px] leading-relaxed text-ink-muted">
            A production-grade retrieval pipeline, not a single embedding call — every stage below runs on
            every question you ask.
          </p>
        </motion.div>

        <motion.div
          variants={reduceMotion ? undefined : container}
          initial={reduceMotion ? undefined : 'hidden'}
          whileInView={reduceMotion ? undefined : 'show'}
          viewport={{ once: true, margin: '-80px' }}
          className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <motion.div
              key={title}
              variants={reduceMotion ? undefined : item}
              className="group rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-accent/40"
              style={{ boxShadow: 'var(--shadow-xs)' }}
            >
              <div
                className="flex size-10 items-center justify-center rounded-xl text-accent"
                style={{ background: 'color-mix(in srgb, var(--accent) 10%, transparent)' }}
              >
                <Icon size={18} strokeWidth={2} />
              </div>
              <h3 className="mt-4 font-serif text-lg text-ink">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
