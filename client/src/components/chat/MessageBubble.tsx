import { motion } from 'framer-motion';
import { ChevronDown, Sparkles, Search } from 'lucide-react';
import { useState } from 'react';
import { AnswerText } from '../citations/AnswerText';
import { CitationBadge } from '../citations/CitationBadge';
import type { Message } from '../../lib/types';

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end"
      >
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] text-accent-ink">
          {message.content}
        </div>
      </motion.div>
    );
  }

  const sources = message.sources || [];
  const cited = sources.filter((s) => s.cited);
  const uncited = sources.filter((s) => !s.cited);
  const showSearching = message.isStreaming && message.phase === 'searching';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex gap-3"
    >
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Sparkles size={12} />
      </div>
      <div className="min-w-0 max-w-[85%] flex-1">
        {showSearching ? (
          <SearchingIndicator />
        ) : (
          <>
            <AnswerText content={message.content} sources={message.sources} />
            {message.isStreaming && <StreamingCursor />}
            {!message.isStreaming && sources.length > 0 && (
              <SourcesSummary citedCount={cited.length} uncited={uncited} />
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

function SearchingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <Search size={13} className="shrink-0" />
      <span>Searching your documents</span>
      <span className="flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1 w-1 rounded-full bg-ink-muted"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </span>
    </div>
  );
}

function StreamingCursor() {
  return (
    <motion.span
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-accent align-middle"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.9, repeat: Infinity, ease: 'linear', times: [0, 0.5, 0.5, 1] }}
    />
  );
}

function SourcesSummary({ citedCount, uncited }: { citedCount: number; uncited: Message['sources'] }) {
  const [open, setOpen] = useState(false);
  const uncitedList = uncited || [];
  if (citedCount === 0 && uncitedList.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={uncitedList.length === 0}
        className="flex items-center gap-1 text-xs text-ink-muted disabled:cursor-default cursor-pointer"
      >
        {citedCount > 0 && <span>{citedCount} source{citedCount !== 1 ? 's' : ''} used</span>}
        {uncitedList.length > 0 && (
          <>
            {citedCount > 0 && <span>·</span>}
            <span>{uncitedList.length} more considered</span>
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>
      {open && uncitedList.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {uncitedList.map((s) => (
            <CitationBadge key={s.sourceNumber} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}
