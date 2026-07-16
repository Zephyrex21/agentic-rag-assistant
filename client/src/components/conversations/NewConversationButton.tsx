import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';

export function NewConversationButton() {
  const { createConversation } = useConversations();

  return (
    <motion.button
      type="button"
      onClick={() => createConversation()}
      whileTap={{ scale: 0.97 }}
      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink cursor-pointer"
    >
      <Plus size={14} />
      New conversation
    </motion.button>
  );
}
