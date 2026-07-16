import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquarePlus, MessageSquare, FileText, Sun, Moon, Search } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';
import { useTheme } from '../../context/ThemeContext';

interface CommandPaletteProps {
  onNavigateToDocuments: () => void;
}

export function CommandPalette({ onNavigateToDocuments }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const { conversations, createConversation, selectConversation } = useConversations();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[100] bg-overlay"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-1/2 top-[18vh] z-[101] w-[92vw] max-w-lg -translate-x-1/2"
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                <Command
                  className="glass-panel overflow-hidden rounded-2xl shadow-2xl"
                  shouldFilter={true}
                >
                  <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                    <Search size={15} className="shrink-0 text-ink-muted" />
                    <Command.Input
                      autoFocus
                      placeholder="Search conversations or run a command..."
                      className="w-full bg-transparent text-[15px] text-ink placeholder:text-ink-muted focus:outline-none"
                    />
                    <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-ink-muted sm:block">
                      esc
                    </kbd>
                  </div>

                  <Command.List className="max-h-80 overflow-y-auto p-2">
                    <Command.Empty className="px-3 py-6 text-center text-sm text-ink-muted">
                      No results found.
                    </Command.Empty>

                    <Command.Group heading="Actions" className="cmdk-group">
                      <Command.Item
                        onSelect={() => run(() => createConversation())}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-background cursor-pointer"
                      >
                        <MessageSquarePlus size={15} className="text-accent" />
                        New conversation
                      </Command.Item>
                      <Command.Item
                        onSelect={() => run(onNavigateToDocuments)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-background cursor-pointer"
                      >
                        <FileText size={15} className="text-accent" />
                        Go to documents
                      </Command.Item>
                      <Command.Item
                        onSelect={() => run(toggleTheme)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-background cursor-pointer"
                      >
                        {theme === 'dark' ? <Sun size={15} className="text-accent" /> : <Moon size={15} className="text-accent" />}
                        Switch to {theme === 'dark' ? 'light' : 'dark'} mode
                      </Command.Item>
                    </Command.Group>

                    {conversations.length > 0 && (
                      <Command.Group heading="Conversations" className="cmdk-group">
                        {conversations.map((c) => (
                          <Command.Item
                            key={c.id}
                            value={c.title}
                            onSelect={() => run(() => selectConversation(c.id))}
                            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink data-[selected=true]:bg-background cursor-pointer"
                          >
                            <MessageSquare size={15} className="shrink-0 text-ink-muted" />
                            <span className="truncate">{c.title}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
