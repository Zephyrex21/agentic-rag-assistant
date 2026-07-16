import * as Popover from '@radix-ui/react-popover';
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
        <button
          type="button"
          aria-label={`Show source ${source.sourceNumber}: ${source.filename}`}
          className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center rounded-full bg-highlight/15 px-1.5 font-mono text-[10px] font-medium text-highlight transition-colors hover:bg-highlight/25 cursor-pointer"
        >
          {source.sourceNumber}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="center" sideOffset={8} className="z-50">
          <CitationCard source={source} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
