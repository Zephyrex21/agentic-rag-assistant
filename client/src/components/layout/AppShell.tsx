import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { LogoMark } from '../LogoMark';

interface AppShellProps {
  sidebar: ReactNode;
  main: ReactNode;
}

export function AppShell({ sidebar, main }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="relative flex h-svh w-full overflow-hidden bg-background text-ink">
      {/* A single hairline scanline that quietly sweeps the full width once
          every ~8s - the signature "signal" motif reduced to its most
          ambient form, present at the shell level so it reads as part of
          the instrument's own idle behavior rather than a loading state. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[60] h-px overflow-hidden opacity-40">
        <div
          className="signal-scanline h-full w-1/3"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
            animation: 'signal-scan 8s linear infinite',
          }}
        />
      </div>

      {/* Desktop sidebar - always visible, static */}
      <aside className="hidden w-[19rem] shrink-0 border-r border-border md:block" style={{ boxShadow: 'var(--shadow-lg)' }}>
        {sidebar}
      </aside>

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
                className="absolute right-3 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-raised text-ink cursor-pointer"
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
        <div className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-ink cursor-pointer"
          >
            <Menu size={16} />
          </button>
          <LogoMark size={18} />
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-muted">Signal</span>
        </div>

        <div className="min-h-0 flex-1">{main}</div>
      </div>
    </div>
  );
}
