import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, FileText } from 'lucide-react';
import { ThemeToggle } from '../ThemeToggle';
import { LogoMark } from '../LogoMark';

export type SidebarTab = 'chats' | 'documents';

interface SidebarProps {
  chatsSlot: ReactNode;
  documentsSlot: ReactNode;
  newConversationSlot: ReactNode;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
}

export function Sidebar({ chatsSlot, documentsSlot, newConversationSlot, tab, onTabChange }: SidebarProps) {
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">
          <LogoMark size={16} />
          RAG Assistant
        </span>
        <div className="flex items-center gap-2">
          <kbd className="hidden items-center gap-0.5 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-muted sm:flex">
            <span>⌘</span>K
          </kbd>
          <ThemeToggle />
        </div>
      </div>

      <div className="px-5 pt-4">{newConversationSlot}</div>

      <div className="mt-4 flex gap-0.5 rounded-xl bg-background p-1 mx-5" style={{ width: 'calc(100% - 2.5rem)' }}>
        <TabButton active={tab === 'chats'} onClick={() => onTabChange('chats')} icon={<MessageSquare size={14} />}>
          Chats
        </TabButton>
        <TabButton active={tab === 'documents'} onClick={() => onTabChange('documents')} icon={<FileText size={14} />}>
          Documents
        </TabButton>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-3 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: tab === 'chats' ? -8 : 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === 'chats' ? 8 : -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {tab === 'chats' ? chatsSlot : documentsSlot}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer"
    >
      {active && (
        <motion.div
          layoutId="sidebar-tab-active"
          className="absolute inset-0 rounded-lg bg-surface shadow-sm"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
      <span className={`relative z-10 flex items-center gap-1.5 ${active ? 'text-ink' : 'text-ink-muted'}`}>
        {icon}
        {children}
      </span>
    </button>
  );
}
