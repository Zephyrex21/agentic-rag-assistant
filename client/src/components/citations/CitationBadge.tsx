import * as Popover from '@radix-ui/react-popover';
import { motion } from 'framer-motion';
import { CitationCard } from './CitationCard';
import type { Source } from '../../lib/types';

export function CitationBadge({ source, animate = true }: { source: Source | undefined; animate?: boolean }) {
  // If a source number in the text somehow doesn't match a retrieved source
  // (shouldn't happen, but LLM output isn't 100% guaranteed), fail quietly
  // by rendering plain text instead of a broken interactive element.
  if (!source) return null;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <motion.button
          type="button"
          aria-label={`Show source ${source.sourceNumber}: ${source.filename}`}
          // While an answer is still streaming, react-markdown re-parses the
          // WHOLE growing text on every chunk, which can cause already-
          // rendered badges to remount rather than just update - with the
          // entrance animation always on, that replayed the "stamp" effect
          // repeatedly as the answer grew, reading as a distracting flicker
          // instead of a one-time flourish. `initial={false}` skips the
          // entrance animation entirely (renders straight into its final
          // state) while streaming; the real stamp-in only plays once, for
          // the settled final render - see AnswerText/MessageBubble.
          initial={animate ? { opacity: 0, scale: 2, rotate: -22 } : false}
          animate={{ opacity: 1, scale: 1, rotate: -3 }}
          whileHover={{ rotate: 0, scale: 1.1, y: -1 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16, mass: 0.6 }}
          className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center px-1.5 font-mono text-[10px] font-semibold cursor-pointer"
          style={{
            borderRadius: '3px',
            background: 'color-mix(in srgb, var(--highlight) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--highlight) 55%, transparent)',
            color: 'var(--highlight)',
            boxShadow: '0 0 8px -2px color-mix(in srgb, var(--highlight) 60%, transparent)',
          }}
        >
          {source.sourceNumber}
        </motion.button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} className="z-50">
          <CitationCard source={source} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
