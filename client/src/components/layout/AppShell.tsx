import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export function AppShell({ sidebar, main }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="flex h-svh w-full overflow-hidden bg-background">
      {/* Desktop sidebar - always visible, static */}
      <aside className="hidden w-80 shrink-0 border-r border-border md:block">{sidebar}</aside>

      {/* Mobile sidebar - slide-over with backdrop */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-overlay md:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 w-[85vw] max-w-80 border-r border-border shadow-2xl md:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-ink cursor-pointer"
              >
                <X size={16} />
              </button>
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink cursor-pointer"
          >
            <Menu size={16} />
          </button>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
            RAG Assistant
          </span>
        </div>

        <div className="min-h-0 flex-1">{main}</div>
      </div>
    </div>
  );
}
