import { AnimatePresence, motion } from 'framer-motion';
import { Coffee } from 'lucide-react';
import { useConversations } from '../context/ConversationsContext';

/**
 * Shown only once, only if the very first backend request takes long
 * enough to suggest a cold start (the backend spins down after inactivity
 * on a free hosting tier, and waking back up can take up to ~a minute) -
 * see COLD_START_THRESHOLD_MS in ConversationsContext.tsx. A normally-warm
 * backend responds well under that threshold and this never appears.
 */
export function ColdStartNotice() {
  const { isColdStarting } = useConversations();

  return (
    <AnimatePresence>
      {isColdStarting && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="fixed left-1/2 top-4 z-[200] flex max-w-[90vw] -translate-x-1/2 items-center gap-2.5 rounded-full px-4 py-2 text-xs shadow-lg"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--ink-muted)' }}
        >
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
            className="flex shrink-0 text-accent"
          >
            <Coffee size={13} />
          </motion.span>
          <span>
            Waking up the server — it runs on a free hosting tier and naps when idle, so this can take up to a
            minute. Thanks for your patience!
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
