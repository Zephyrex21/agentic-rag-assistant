import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';

export function NewConversationButton() {
  const { createConversation } = useConversations();

  return (
    <motion.button
      type="button"
      onClick={() => createConversation()}
      whileHover={{ scale: 1.015, y: -1 }}
      whileTap={{ scale: 0.97, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-accent-ink cursor-pointer"
      style={{
        background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
        boxShadow:
          '0 1px 0 0 rgba(255,255,255,0.2) inset, 0 4px 20px -4px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)',
      }}
    >
      <Plus size={14} />
      New conversation
    </motion.button>
  );
}
