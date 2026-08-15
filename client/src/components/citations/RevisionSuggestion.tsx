import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, Check } from 'lucide-react';
import { useState } from 'react';
import { AnswerText } from './AnswerText';
import type { Message } from '../../lib/types';

type PendingRevision = NonNullable<Message['pendingRevision']>;

/**
 * A background self-verification check found a problem with an answer that
 * was already shown and generated a corrected version - but it's offered
 * as a dismissible SUGGESTION, never applied automatically. Rewriting an
 * answer someone already started reading, out from under them, feels like
 * the app changed its mind on them even when the correction is genuinely
 * better - so the person decides, not the pipeline.
 */
export function RevisionSuggestion({
  revision,
  onAccept,
  onDismiss,
}: {
  revision: PendingRevision;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs"
        style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', color: 'var(--accent)' }}
      >
        <Sparkles size={12} className="shrink-0" />
        <span className="flex-1">A double-check found a possible improvement to this answer.</span>
        <Dialog.Trigger asChild>
          <button type="button" className="cursor-pointer font-medium underline decoration-dotted underline-offset-2 hover:opacity-80">
            Review
          </button>
        </Dialog.Trigger>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestion"
          className="cursor-pointer text-ink-muted hover:text-ink"
        >
          <X size={12} />
        </button>
      </motion.div>

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
                className="fixed left-1/2 top-[10vh] z-[101] max-h-[80vh] w-[92vw] max-w-xl -translate-x-1/2 overflow-y-auto rounded-2xl"
              >
                <div className="glass-panel rounded-2xl p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <Dialog.Title className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                      <Sparkles size={14} className="text-accent" />
                      Suggested improvement
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="cursor-pointer text-ink-muted hover:text-ink" aria-label="Close">
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>

                  <p className="mb-3 rounded-md px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--surface)', color: 'var(--ink-muted)' }}>
                    Why: {revision.issue}
                  </p>

                  <div className="mb-4 rounded-xl border border-border p-3.5" style={{ background: 'var(--surface)' }}>
                    <AnswerText content={revision.answer} sources={revision.sources} />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        onClick={onDismiss}
                        className="cursor-pointer rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
                      >
                        Keep current answer
                      </button>
                    </Dialog.Close>
                    <Dialog.Close asChild>
                      <button
                        type="button"
                        onClick={onAccept}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-ink"
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
                      >
                        <Check size={13} />
                        Use this version
                      </button>
                    </Dialog.Close>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
