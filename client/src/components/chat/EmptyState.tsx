import { motion } from 'framer-motion';
import { MessageSquarePlus } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';

export function EmptyState() {
  const { createConversation } = useConversations();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent"
      >
        <MessageSquarePlus size={24} />
      </motion.div>
      <div>
        <h2 className="font-serif text-2xl text-ink">Start a conversation</h2>
        <p className="mt-1 max-w-xs text-sm text-ink-muted">
          Upload a document from the sidebar, then ask it anything.
        </p>
      </div>
      <button
        type="button"
        onClick={() => createConversation()}
        className="mt-2 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink cursor-pointer"
      >
        New conversation
      </button>
    </div>
  );
}
