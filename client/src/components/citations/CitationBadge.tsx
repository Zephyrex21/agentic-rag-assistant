import * as Popover from '@radix-ui/react-popover';
import { motion } from 'framer-motion';
import { CitationCard } from './CitationCard';
import type { Source } from '../../lib/types';

export function CitationBadge({ source }: { source: Source | undefined }) {
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
          initial={{ rotate: -3 }}
          whileHover={{ rotate: 0, scale: 1.08, y: -1 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center px-1.5 font-mono text-[10px] font-semibold cursor-pointer"
          style={{
            borderRadius: '3px',
            background: 'color-mix(in srgb, var(--highlight) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--highlight) 55%, transparent)',
            color: 'var(--highlight)',
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
