import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');
  const [sendCount, setSendCount] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setSendCount((c) => c + 1);
  };

  const canSend = !disabled && value.trim().length > 0;

  return (
    <form
      onSubmit={submit}
      className="flex items-end gap-2 border-t border-border-subtle bg-surface p-4"
      style={{ boxShadow: '0 -8px 24px -12px rgba(22,22,26,0.06)' }}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            submit(e);
          }
        }}
        placeholder="Ask a question about your documents..."
        rows={1}
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-background px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted transition-shadow duration-200 focus:outline-none"
        style={{ boxShadow: 'none' }}
        onFocus={(e) => (e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)')}
        onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
      />
      <motion.button
        type="submit"
        disabled={!canSend}
        whileHover={canSend ? { scale: 1.05 } : {}}
        whileTap={canSend ? { scale: 0.92 } : {}}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-accent-ink transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          boxShadow: canSend ? '0 1px 0 0 rgba(255,255,255,0.15) inset, 0 4px 14px -4px var(--accent)' : 'none',
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={sendCount}
            initial={{ y: 0, opacity: 1 }}
            exit={{ y: -28, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex"
          >
            <ArrowUp size={18} />
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </form>
  );
}
