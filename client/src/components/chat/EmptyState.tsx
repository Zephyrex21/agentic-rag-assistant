import { motion, type Variants } from 'framer-motion';
import { MessageSquarePlus } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export function EmptyState() {
  const { createConversation } = useConversations();

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <motion.div variants={item} className="relative flex h-14 w-14 items-center justify-center">
        {/* Soft pulsing ring behind the icon - a quiet "ready and waiting" cue */}
        <motion.span
          className="absolute inset-0 rounded-2xl bg-accent/10"
          animate={{ scale: [1, 1.35, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"
        >
          <MessageSquarePlus size={24} />
        </motion.div>
      </motion.div>
      <motion.div variants={item}>
        <h2 className="font-serif text-2xl text-ink">Start a conversation</h2>
        <p className="mt-1 max-w-xs text-sm text-ink-muted">
          Upload a document from the sidebar, then ask it anything.
        </p>
      </motion.div>
      <motion.button
        variants={item}
        type="button"
        onClick={() => createConversation()}
        whileHover={{ scale: 1.04, y: -1 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className="mt-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink cursor-pointer"
        style={{ boxShadow: '0 4px 14px -4px var(--accent)' }}
      >
        New conversation
      </motion.button>
    </motion.div>
  );
}
