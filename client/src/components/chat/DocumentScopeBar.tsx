import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { motion } from 'framer-motion';
import { FileText, ChevronDown, X, Check, Upload, Globe } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';
import { useDocuments } from '../../context/DocumentsContext';

export function DocumentScopeBar() {
  const { activeScope, setActiveScope } = useConversations();
  const { documents, upload } = useDocuments();
  const [open, setOpen] = useState(false);

  const scopedDocs = documents.filter((d) => activeScope.includes(d.id));
  const readyDocs = documents.filter((d) => d.status === 'ready');

  const toggleDoc = (id: string) => {
    if (activeScope.includes(id)) {
      setActiveScope(activeScope.filter((x) => x !== id));
    } else {
      setActiveScope([...activeScope, id]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2.5 sm:px-6">
      {scopedDocs.length === 0 ? (
        <span className="flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs text-ink-muted">
          <Globe size={11} />
          Searching all documents
        </span>
      ) : (
        scopedDocs.map((d) => (
          <span
            key={d.id}
            className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
          >
            <FileText size={11} />
            <span className="max-w-[10rem] truncate">{d.filename}</span>
            <button
              type="button"
              onClick={() => toggleDoc(d.id)}
              aria-label={`Remove ${d.filename} from scope`}
              className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20 cursor-pointer"
            >
              <X size={10} />
            </button>
          </span>
        ))
      )}

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-accent hover:text-accent cursor-pointer"
          >
            Scope
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={8} className="z-50">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="glass-panel w-72 rounded-2xl p-3 shadow-2xl"
            >
              <p className="px-1 pb-2 text-xs font-medium text-ink-muted">
                Search only these documents
              </p>

              {readyDocs.length === 0 ? (
                <p className="px-1 py-2 text-xs text-ink-muted">
                  No documents ready yet. Upload one below.
                </p>
              ) : (
                <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                  {readyDocs.map((d) => {
                    const selected = activeScope.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDoc(d.id)}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background cursor-pointer"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            selected ? 'border-accent bg-accent text-accent-ink' : 'border-border'
                          }`}
                        >
                          {selected && <Check size={10} />}
                        </span>
                        <span className="truncate text-ink">{d.filename}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {activeScope.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveScope([])}
                  className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-background cursor-pointer"
                >
                  Clear — search all documents instead
                </button>
              )}

              <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-2 text-xs text-ink-muted hover:border-accent hover:text-accent">
                <Upload size={12} />
                Upload a new document
                <input
                  type="file"
                  accept=".txt,.md,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </motion.div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
