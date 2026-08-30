import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, FileText, Home, LogIn, LogOut, User } from 'lucide-react';
import { LogoMark } from '../LogoMark';
import { ThemeToggle } from '../ThemeToggle';
import { AuthModal } from '../auth/AuthModal';
import { useAuth } from '../../context/AuthContext';

export type SidebarTab = 'chats' | 'documents';

interface SidebarProps {
  chatsSlot: ReactNode;
  documentsSlot: ReactNode;
  newConversationSlot: ReactNode;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onGoHome: () => void;
}

export function Sidebar({ chatsSlot, documentsSlot, newConversationSlot, tab, onTabChange, onGoHome }: SidebarProps) {
  const { user, logout } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <div className="flex items-center justify-between px-5 pt-5">
        <span className="flex items-center gap-2.5">
          <LogoMark size={19} />
          <span className="font-signal-display text-[19px] italic leading-none text-ink">Signal</span>
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onGoHome}
            aria-label="Back to homepage"
            title="Back to homepage"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted transition-colors hover:border-accent hover:text-accent cursor-pointer"
          >
            <Home size={13} />
          </button>
          <ThemeToggle />
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between px-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-muted">
          Grounded document intelligence
        </p>
        <kbd className="hidden items-center gap-0.5 rounded-md border border-border bg-background px-1.5 py-1 font-mono text-[10px] text-ink-muted sm:flex">
          <span>⌘</span>K
        </kbd>
      </div>

      {/* Account status - guest mode needs no account at all (see
          AuthContext.tsx); this is purely an opt-in affordance. A logged-in
          person's email is shown so it's always clear whose documents/
          conversations are currently in view. */}
      <div className="mx-5 mt-3 flex items-center justify-between rounded-xl border border-border-subtle bg-background px-3 py-2">
        {user ? (
          <>
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
              <User size={13} className="shrink-0 text-accent" />
              <span className="truncate">{user.email}</span>
            </span>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Log out"
              title="Log out"
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] text-ink-muted transition-colors hover:text-highlight cursor-pointer"
            >
              <LogOut size={12} />
              Log out
            </button>
          </>
        ) : (
          <>
            <span className="text-[13px] text-ink-muted">Browsing as guest</span>
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-accent transition-opacity hover:opacity-80 cursor-pointer"
            >
              <LogIn size={12} />
              Sign in
            </button>
          </>
        )}
      </div>
      <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />

      <div className="px-5 pt-4">{newConversationSlot}</div>

      <div className="mx-5 mt-4 flex gap-0.5 rounded-xl border border-border-subtle bg-background p-1" style={{ width: 'calc(100% - 2.5rem)' }}>
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
          className="absolute inset-0 rounded-lg bg-surface-raised shadow-sm"
          style={{ boxShadow: '0 0 0 1px var(--border-color), 0 0 12px -2px color-mix(in srgb, var(--accent) 35%, transparent)' }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
      <span className={`relative z-10 flex items-center gap-1.5 ${active ? 'text-accent' : 'text-ink-muted'}`}>
        {icon}
        {children}
      </span>
    </button>
  );
}
