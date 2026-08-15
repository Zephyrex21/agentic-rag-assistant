import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Sparkles, Search, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { AnswerText } from '../citations/AnswerText';
import { CitationBadge } from '../citations/CitationBadge';
import { RevisionSuggestion } from '../citations/RevisionSuggestion';
import { PipelineInspectorTrigger } from '../inspector/PipelineInspector';
import { useConversations } from '../../context/ConversationsContext';
import type { Message } from '../../lib/types';

export function MessageBubble({ message }: { message: Message }) {
  const { acceptRevision, dismissRevision } = useConversations();

  if (message.role === 'user') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="flex justify-end"
      >
        <div
          className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] text-accent-ink"
          style={{
            background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
            boxShadow: '0 1px 0 0 rgba(255,255,255,0.15) inset, 0 4px 14px -6px var(--accent)',
          }}
        >
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
      <div
        className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-accent-ink"
        style={{
          background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
          boxShadow: '0 2px 8px -2px var(--accent)',
        }}
      >
        <Sparkles size={13} />
      </div>
      <div className="min-w-0 max-w-[85%] flex-1">
        <AnimatePresence mode="wait">
          {showSearching ? (
            <motion.div key="searching" exit={{ opacity: 0 }}>
              <SearchingIndicator />
            </motion.div>
          ) : (
            <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <AnswerText content={message.content} sources={message.sources} />
              {message.isStreaming && <StreamingCursor />}
              {!message.isStreaming && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {sources.length > 0 && <SourcesSummary citedCount={cited.length} uncited={uncited} />}
                    <VerificationBadge verified={message.verified} wasRevised={message.wasRevised} />
                    {message.pipelineTrace && <PipelineInspectorTrigger trace={message.pipelineTrace} />}
                  </div>
                  {message.pendingRevision && (
                    <RevisionSuggestion
                      revision={message.pendingRevision}
                      onAccept={() => acceptRevision(message.id)}
                      onDismiss={() => dismissRevision(message.id)}
                    />
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
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

/**
 * Deliberately quiet in the common case (verified on the first try - no
 * badge at all, avoids clutter on every single answer). Only speaks up
 * when something notable happened: a self-correction (positive framing -
 * it caught its own mistake) or a still-uncertain answer after one
 * revision attempt (honest, not alarmist).
 */
function VerificationBadge({ verified, wasRevised }: { verified?: boolean | null; wasRevised?: boolean }) {
  if (!wasRevised) return null;

  if (verified) {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.7, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        className="flex items-center gap-1 text-xs text-accent"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 500, damping: 15 }}
        >
          <ShieldCheck size={12} />
        </motion.span>
        Revised for accuracy
      </motion.span>
    );
  }

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.7, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className="flex items-center gap-1 text-xs text-highlight"
    >
      <ShieldAlert size={12} />
      May not be fully supported by the sources
    </motion.span>
  );
}

function SourcesSummary({ citedCount, uncited }: { citedCount: number; uncited: Message['sources'] }) {
  const [open, setOpen] = useState(false);
  const uncitedList = uncited || [];
  if (citedCount === 0 && uncitedList.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
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
            <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="flex">
              <ChevronDown size={11} />
            </motion.span>
          </>
        )}
      </button>
      <AnimatePresence>
        {open && uncitedList.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="mt-1.5 flex flex-wrap items-center gap-1 overflow-hidden"
          >
            {uncitedList.map((s) => (
              <CitationBadge key={s.sourceNumber} source={s} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
