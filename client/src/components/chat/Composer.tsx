import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp } from 'lucide-react';

export function Composer({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-surface p-4">
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
        className="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
      <motion.button
        type="submit"
        disabled={disabled || !value.trim()}
        whileTap={{ scale: 0.92 }}
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      >
        <ArrowUp size={18} />
      </motion.button>
    </form>
  );
}
