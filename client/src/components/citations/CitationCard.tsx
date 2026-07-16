import { useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, ChevronDown } from 'lucide-react';
import type { Source } from '../../lib/types';

export function CitationCard({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const showExpandToggle = source.fullText.length > source.excerpt.length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="glass-panel w-80 max-w-[85vw] rounded-2xl p-4 shadow-2xl"
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-highlight/15 text-highlight">
          <FileText size={12} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{source.filename}</p>
          {source.section && <p className="text-xs text-ink-muted">{source.section}</p>}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink">
        {expanded ? source.fullText : source.excerpt}
      </p>

      {showExpandToggle && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 flex items-center gap-1 text-xs font-medium text-accent cursor-pointer"
        >
          {expanded ? 'Show less' : 'Show full excerpt'}
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
        <span className="font-mono text-[10px] text-ink-muted">
          chunk {source.chunkIndex} · relevance {source.relevanceScore.toFixed(2)}
        </span>
      </div>
    </motion.div>
  );
}
