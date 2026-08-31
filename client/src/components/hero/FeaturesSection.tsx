import { useRef, type MouseEvent } from 'react';
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
 * A single feature card with a cursor-tracked "spotlight" glow, a gradient
 * icon badge, and a hover-revealed top accent line. The mouse position is
 * written straight to CSS custom properties on the DOM node (via ref)
 * rather than React state, so hovering/moving over a card never triggers a
 * re-render - only the already-GPU-composited gradient background repaints.
 */
function FeatureCard({ icon: Icon, title, description, index }: Feature & { index: number }) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    cardRef.current!.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    cardRef.current!.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  };

  return (
    <motion.div
      ref={cardRef}
      variants={item}
      onMouseMove={handleMouseMove}
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface p-6 transition-all duration-300 hover:-translate-y-1"
      style={{ boxShadow: 'var(--shadow-xs)' }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-lg)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-xs)')}
    >
      {/* Cursor-tracked spotlight - invisible until hovered, then follows
          the pointer via the --spot-x/--spot-y vars set above. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(280px circle at var(--spot-x, 50%) var(--spot-y, 50%), color-mix(in srgb, var(--accent) 13%, transparent), transparent 72%)',
        }}
      />
      {/* Gradient top edge, revealed on hover - a subtle "this one's lit up" cue. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px] origin-left scale-x-0 transition-transform duration-300 ease-out group-hover:scale-x-100"
        style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }}
      />

      <span className="absolute right-5 top-5 select-none font-mono text-[11px] text-ink-muted/35">
        {String(index + 1).padStart(2, '0')}
      </span>

      <div
        className="relative flex size-11 items-center justify-center rounded-xl text-accent-ink transition-transform duration-300 ease-out group-hover:scale-110 group-hover:rotate-3"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))', boxShadow: '0 8px 20px -8px var(--accent)' }}
      >
        <Icon size={19} strokeWidth={2} />
      </div>

      <h3 className="relative mt-5 font-serif text-lg text-ink">{title}</h3>
      <p className="relative mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{description}</p>
    </motion.div>
  );
}

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
    <section id="features" className="relative overflow-hidden border-t border-border bg-background px-6 py-20 sm:px-10 sm:py-28">
      {/* Faint ambient glow behind the heading, echoing the hero's own
          radial treatment so the transition between sections doesn't feel
          like two unrelated pages stitched together. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[420px]"
        style={{ background: 'radial-gradient(ellipse 50% 60% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%)' }}
      />

      <div className="relative mx-auto max-w-5xl">
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
          {FEATURES.map((feature, index) => (
            <FeatureCard key={feature.title} {...feature} index={index} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
