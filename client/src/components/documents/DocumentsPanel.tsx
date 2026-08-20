import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import * as Popover from '@radix-ui/react-popover';
import {
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Upload,
  Search,
  Folder as FolderIcon,
  FolderPlus,
  Plus,
  Check,
} from 'lucide-react';
import { useDocuments } from '../../context/DocumentsContext';
import { DocumentRowSkeleton } from '../ui/Skeleton';
import type { DocumentSummary, Folder } from '../../lib/types';

const ACCEPTED = '.txt,.md,.pdf,.docx';
// Below this count, a search box just adds clutter for no real benefit -
// scanning a handful of filenames by eye is faster than typing.
const SEARCH_THRESHOLD = 6;
// 'all' | 'uncategorized' | an actual folder id
type FolderFilter = 'all' | 'uncategorized' | string;

export function DocumentsPanel() {
  const { documents, loading, uploadError, upload, remove, folders, createFolder, deleteFolder, moveToFolder } =
    useDocuments();
  const [dragActive, setDragActive] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState<FolderFilter>('all');
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
      const folderId = activeFolder === 'all' || activeFolder === 'uncategorized' ? null : activeFolder;
      Array.from(files).forEach((file) => upload(file, folderId));
    },
    [upload, activeFolder]
  );

  const byFolder = useMemo(() => {
    if (activeFolder === 'all') return documents;
    if (activeFolder === 'uncategorized') return documents.filter((d) => !d.folderId);
    return documents.filter((d) => d.folderId === activeFolder);
  }, [documents, activeFolder]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return byFolder;
    return byFolder.filter((d) => d.filename.toLowerCase().includes(q));
  }, [byFolder, query]);

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
        <p className="font-mono text-[10px] text-ink-muted/70">.txt · .md · .pdf · .docx</p>
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

      <FolderChips
        folders={folders}
        active={activeFolder}
        onSelect={setActiveFolder}
        onCreate={createFolder}
        onDelete={(id) => {
          deleteFolder(id);
          if (activeFolder === id) setActiveFolder('all');
        }}
      />

      {documents.length >= SEARCH_THRESHOLD && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Search size={12} className="shrink-0 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter documents..."
            className="w-full bg-transparent text-xs text-ink placeholder:text-ink-muted focus:outline-none"
          />
        </div>
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
        {!loading && documents.length > 0 && byFolder.length === 0 && (
          <p className="px-1 text-xs text-ink-muted">No documents in this folder yet.</p>
        )}
        {!loading && byFolder.length > 0 && filtered.length === 0 && (
          <p className="px-1 text-xs text-ink-muted">No documents match "{query}".</p>
        )}
        <AnimatePresence initial={false}>
          {filtered.map((doc, i) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              folders={folders}
              onRemove={remove}
              onMove={moveToFolder}
              delay={isFirstMount.current ? i * 0.05 : 0}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function FolderChips({
  folders,
  active,
  onSelect,
  onCreate,
  onDelete,
}: {
  folders: Folder[];
  active: FolderFilter;
  onSelect: (f: FolderFilter) => void;
  onCreate: (name: string) => Promise<Folder | null>;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    const folder = await onCreate(trimmed);
    setName('');
    setCreating(false);
    if (folder) onSelect(folder.id);
  };

  if (folders.length === 0 && !creating) {
    return (
      <button
        type="button"
        onClick={() => {
          setCreating(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent cursor-pointer"
      >
        <FolderPlus size={12} />
        Organize into folders
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip label="All" active={active === 'all'} onClick={() => onSelect('all')} />
      <Chip label="Uncategorized" active={active === 'uncategorized'} onClick={() => onSelect('uncategorized')} />
      {folders.map((f) => (
        <Chip
          key={f.id}
          label={f.name}
          active={active === f.id}
          onClick={() => onSelect(f.id)}
          onDelete={() => onDelete(f.id)}
        />
      ))}
      {creating ? (
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') {
              setName('');
              setCreating(false);
            }
          }}
          placeholder="Folder name"
          className="w-28 rounded-full border border-accent bg-background px-2.5 py-1 text-xs text-ink focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          aria-label="New folder"
          title="New folder"
          className="flex items-center justify-center rounded-full border border-dashed border-border p-1 text-ink-muted transition-colors hover:border-accent hover:text-accent cursor-pointer"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  onDelete,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
          active ? 'bg-accent text-accent-ink' : 'border border-border text-ink-muted hover:border-accent hover:text-accent'
        }`}
      >
        {label}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirming) {
              onDelete();
              setConfirming(false);
            } else {
              setConfirming(true);
            }
          }}
          onBlur={() => setConfirming(false)}
          aria-label={`Delete folder ${label}`}
          title={confirming ? 'Click again to confirm' : 'Delete folder'}
          className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] opacity-0 transition-opacity group-hover:opacity-100 cursor-pointer ${
            confirming ? 'bg-highlight text-highlight-ink opacity-100' : 'bg-ink-muted text-surface'
          }`}
        >
          ×
        </button>
      )}
    </span>
  );
}

function DocumentRow({
  doc,
  folders,
  onRemove,
  onMove,
  delay = 0,
}: {
  doc: DocumentSummary;
  folders: Folder[];
  onRemove: (id: string) => void;
  onMove: (documentId: string, folderId: string | null) => void;
  delay?: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const currentFolder = folders.find((f) => f.id === doc.folderId);

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

      {folders.length > 0 && !confirming && (
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label={`Move ${doc.filename} to a folder`}
              title={currentFolder ? currentFolder.name : 'Move to folder'}
              className={`shrink-0 rounded-md p-1.5 transition-opacity cursor-pointer max-md:opacity-70 ${
                currentFolder ? 'text-accent opacity-100' : 'text-ink-muted opacity-0 group-hover:opacity-100'
              }`}
            >
              <FolderIcon size={13} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content side="bottom" align="end" sideOffset={6} className="z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="glass-panel w-48 rounded-xl p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  onClick={() => {
                    onMove(doc.id, null);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-background cursor-pointer"
                >
                  <span className="flex h-4 w-4 items-center justify-center">{!doc.folderId && <Check size={11} />}</span>
                  Uncategorized
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      onMove(doc.id, f.id);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-background cursor-pointer"
                  >
                    <span className="flex h-4 w-4 items-center justify-center">
                      {doc.folderId === f.id && <Check size={11} />}
                    </span>
                    <span className="truncate">{f.name}</span>
                  </button>
                ))}
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}

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
          className="shrink-0 rounded-md p-1.5 text-ink-muted opacity-0 transition-opacity hover:text-highlight group-hover:opacity-100 max-md:opacity-70 cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      )}
    </motion.div>
  );
}

function StatusLine({ doc }: { doc: DocumentSummary }) {
  const [expanded, setExpanded] = useState(false);

  if (doc.status === 'processing') {
    return (
      <p className="flex items-center gap-1 text-[11px] text-ink-muted">
        <Loader2 size={10} className="animate-spin" /> Processing...
      </p>
    );
  }
  if (doc.status === 'failed') {
    return (
      <div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (doc.error) setExpanded((v) => !v);
          }}
          className={`flex items-center gap-1 text-[11px] text-highlight ${doc.error ? 'cursor-pointer hover:underline' : ''}`}
        >
          <AlertCircle size={10} /> Failed{doc.error ? ' - tap for details' : ''}
        </button>
        {expanded && doc.error && <p className="mt-1 text-[11px] text-ink-muted">{doc.error}</p>}
      </div>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[11px] text-ink-muted">
      <CheckCircle2 size={10} className="text-accent" /> {doc.chunkCount} chunks
    </p>
  );
}
