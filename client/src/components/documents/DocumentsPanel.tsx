import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Loader2, CheckCircle2, AlertCircle, Trash2, Upload } from 'lucide-react';
import { useDocuments } from '../../context/DocumentsContext';
import { DocumentRowSkeleton } from '../ui/Skeleton';
import type { DocumentSummary } from '../../lib/types';

const ACCEPTED = '.txt,.md,.pdf';

export function DocumentsPanel() {
  const { documents, loading, uploadError, upload, remove } = useDocuments();
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Frozen at first render - lets rows stagger in once on initial load,
  // without re-triggering that stagger every time the panel re-renders for
  // unrelated reasons (only a genuinely NEW row added later should use the
  // plain add/remove transition, not a full re-stagger of the whole list).
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (!loading) isFirstMount.current = false;
  }, [loading]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      Array.from(files).forEach((file) => upload(file));
    },
    [upload]
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          dragActive ? 'border-accent bg-accent/5' : 'border-border hover:border-ink-muted'
        }`}
      >
        <Upload size={18} className={dragActive ? 'text-accent' : 'text-ink-muted'} />
        <p className="text-xs text-ink-muted">
          Drop a file or <span className="text-accent">browse</span>
        </p>
        <p className="font-mono text-[10px] text-ink-muted/70">.txt · .md · .pdf</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {uploadError && (
        <p className="rounded-lg bg-highlight/10 px-3 py-2 text-xs text-highlight">{uploadError}</p>
      )}

      <div className="flex flex-col gap-1.5">
        {loading && (
          <>
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
            <DocumentRowSkeleton />
          </>
        )}
        {!loading && documents.length === 0 && (
          <p className="px-1 text-xs text-ink-muted">No documents yet. Upload one to get started.</p>
        )}
        <AnimatePresence initial={false}>
          {documents.map((doc, i) => (
            <DocumentRow key={doc.id} doc={doc} onRemove={remove} delay={isFirstMount.current ? i * 0.05 : 0} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  onRemove,
  delay = 0,
}: {
  doc: DocumentSummary;
  onRemove: (id: string) => void;
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
      className="elevation-hover group flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-background"
    >
      <FileText size={15} className="shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{doc.filename}</p>
        <StatusLine doc={doc} />
      </div>
      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onRemove(doc.id)}
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
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${doc.filename}`}
          className="shrink-0 rounded-md p-1 text-ink-muted opacity-0 transition-opacity hover:text-highlight group-hover:opacity-100 cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      )}
    </motion.div>
  );
}

function StatusLine({ doc }: { doc: DocumentSummary }) {
  if (doc.status === 'processing') {
    return (
      <p className="flex items-center gap-1 text-[11px] text-ink-muted">
        <Loader2 size={10} className="animate-spin" /> Processing...
      </p>
    );
  }
  if (doc.status === 'failed') {
    return (
      <p className="flex items-center gap-1 text-[11px] text-highlight" title={doc.error}>
        <AlertCircle size={10} /> Failed
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[11px] text-ink-muted">
      <CheckCircle2 size={10} className="text-accent" /> {doc.chunkCount} chunks
    </p>
  );
}
