import { motion, type Variants } from 'framer-motion';
import { useConversations } from '../../context/ConversationsContext';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

// The waveform bars - the one signature element this whole theme is built
// around (see index.css's signal-pulse-1/2/3 keyframes). Heights and
// durations are deliberately uneven per bar so it reads as a real signal
// being received, not a uniform decorative blink.
const BARS = [
  { h: 14, dur: 1.1, delay: 0 },
  { h: 22, dur: 1.4, delay: 0.1 },
  { h: 32, dur: 1.0, delay: 0.05 },
  { h: 20, dur: 1.3, delay: 0.15 },
  { h: 26, dur: 1.15, delay: 0.02 },
  { h: 16, dur: 1.5, delay: 0.2 },
];

export function EmptyState() {
  const { createConversation } = useConversations();

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center"
    >
      <motion.div variants={item} className="relative flex h-28 w-28 items-center justify-center">
        {/* A slow rotating dial ring - "tuning" cue, ties to the instrument
            panel concept without being a literal gauge illustration. */}
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ border: '1px solid var(--border-color)' }}
        />
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0%, color-mix(in srgb, var(--accent) 55%, transparent) 8%, transparent 16%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
        />
        <span
          className="absolute inset-[6px] rounded-full"
          style={{ background: 'var(--surface-raised)', boxShadow: 'inset 0 0 0 1px var(--border-color), var(--shadow-md)' }}
        />
        {/* The waveform itself, centered in the dial */}
        <span className="relative flex h-8 items-center gap-[3px]">
          {BARS.map((bar, i) => (
            <span
              key={i}
              className="signal-bar w-[3px] rounded-full"
              style={{
                height: bar.h,
                background: 'var(--accent)',
                boxShadow: '0 0 6px 0 color-mix(in srgb, var(--accent) 70%, transparent)',
                animation: `signal-pulse-${(i % 3) + 1} ${bar.dur}s ease-in-out ${bar.delay}s infinite`,
                transformOrigin: 'center',
              }}
            />
          ))}
        </span>
      </motion.div>
      <motion.div variants={item}>
        <h2 className="font-signal-display text-[32px] italic leading-none text-ink">Awaiting a signal</h2>
        <p className="mt-2.5 max-w-xs text-sm leading-relaxed text-ink-muted">
          Upload a document from the sidebar, then ask it anything - every answer is traced back to the exact
          passage it came from.
        </p>
      </motion.div>
      <motion.button
        variants={item}
        type="button"
        onClick={() => createConversation()}
        whileHover={{ scale: 1.04, y: -1 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className="mt-1 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink cursor-pointer"
        style={{ boxShadow: '0 4px 20px -4px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)' }}
      >
        New conversation
      </motion.button>
    </motion.div>
  );
}
