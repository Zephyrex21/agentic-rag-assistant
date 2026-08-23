import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, Trash2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConversations } from '../../context/ConversationsContext';
import { ConversationRowSkeleton } from '../ui/Skeleton';

// Below this count, a search box just adds clutter - scanning a handful of
// titles by eye is faster than typing (same threshold logic as DocumentsPanel).
const SEARCH_THRESHOLD = 6;

export function ConversationsPanel() {
  const {
    conversations,
    conversationsLoading,
    activeConversationId,
    selectConversation,
    deleteConversation,
  } = useConversations();
  const [query, setQuery] = useState('');

  // Frozen the same way as DocumentsPanel's - flips only once real data has
  // arrived (not on the raw first render, which happens before the async
  // fetch resolves), so the stagger fires exactly once on genuine first load.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (!conversationsLoading) isFirstMount.current = false;
  }, [conversationsLoading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  if (conversationsLoading) {
    return (
      <div className="flex flex-col gap-1">
        <ConversationRowSkeleton />
        <ConversationRowSkeleton />
        <ConversationRowSkeleton />
      </div>
    );
  }

  if (conversations.length === 0) {
    return <p className="px-2 text-xs text-ink-muted">No conversations yet. Start one above.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {conversations.length >= SEARCH_THRESHOLD && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Search size={12} className="shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter conversations..."
            className="w-full bg-transparent text-xs text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </div>
      )}
      {filtered.length === 0 && (
        <p className="px-2 text-xs text-ink-muted">No conversations match "{query}".</p>
      )}
      <div className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {filtered.map((c, i) => (
          <ConversationRow
            key={c.id}
            title={c.title}
            active={c.id === activeConversationId}
            onSelect={() => selectConversation(c.id)}
            onDelete={() => deleteConversation(c.id)}
            delay={isFirstMount.current ? i * 0.04 : 0}
          />
        ))}
      </AnimatePresence>
      </div>
    </div>
  );
}

function ConversationRow({
  title,
  active,
  onSelect,
  onDelete,
  delay = 0,
}: {
  title: string;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  delay?: number;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0, x: -8 }}
      animate={{ opacity: 1, height: 'auto', x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.24, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative"
    >
      <button
        type="button"
        onClick={onSelect}
        className={`group relative flex w-full items-center gap-2 overflow-hidden rounded-xl px-2.5 py-2 text-left text-sm transition-all duration-200 cursor-pointer ${
          active ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:bg-surface-raised/60'
        }`}
        style={
          active
            ? { boxShadow: '0 0 0 1px var(--border-color), 0 0 16px -6px color-mix(in srgb, var(--accent) 60%, transparent)' }
            : undefined
        }
      >
        {active && (
          <motion.span
            layoutId="conversation-active-rail"
            className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
            style={{ background: 'var(--accent)', boxShadow: '0 0 8px 1px var(--accent)' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          />
        )}
        <MessageSquare size={14} className={`shrink-0 ${active ? 'text-accent' : ''}`} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {confirming ? (
          <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md bg-highlight px-1.5 py-0.5 text-[10px] font-medium text-highlight-ink cursor-pointer"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-ink-muted cursor-pointer"
            >
              Cancel
            </button>
          </span>
        ) : (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            aria-label={`Delete conversation ${title}`}
            className="shrink-0 rounded-md p-1.5 opacity-0 transition-opacity hover:text-highlight group-hover:opacity-100 max-md:opacity-70 cursor-pointer"
          >
            <Trash2 size={12} />
          </span>
        )}
      </button>
    </motion.div>
  );
}
