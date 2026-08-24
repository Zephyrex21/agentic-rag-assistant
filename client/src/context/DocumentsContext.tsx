import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createFolder as apiCreateFolder,
  ApiError,
  deleteDocument,
  deleteFolder as apiDeleteFolder,
  getDocumentStatus,
  listDocuments,
  listFolders,
  moveDocumentToFolder,
  uploadDocument,
} from '../lib/api';
import { withRetry } from '../lib/retry';
import type { DocumentSummary, Folder } from '../lib/types';

const POLL_INTERVAL_MS = 2000;

interface DocumentsContextValue {
  documents: DocumentSummary[];
  loading: boolean;
  loadError: string | null;
  uploadError: string | null;
  upload: (file: File, folderId?: string | null) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
  folders: Folder[];
  foldersLoading: boolean;
  createFolder: (name: string) => Promise<Folder | null>;
  deleteFolder: (folderId: string) => Promise<void>;
  moveToFolder: (documentId: string, folderId: string | null) => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | undefined>(undefined);

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => {
    // One retry after a short delay - smooths over the local-dev startup
    // race where the client's first request can land before the backend
    // has finished binding to its port (see lib/retry.ts). A genuine
    // config problem (missing Supabase credentials, wrong URL, etc.)
    // still surfaces clearly via loadError below - this isn't hiding that,
    // just not treating one transient miss as a hard failure.
    withRetry(listDocuments)
      .then(({ documents }) => setDocuments(documents))
      .catch((err) => {
        setLoadError(
          err instanceof Error
            ? `Couldn't load your documents: ${err.message}`
            : "Couldn't load your documents - is the backend server running?"
        );
      })
      .finally(() => setLoading(false));

    // Folders are an optional layer - if the migration hasn't been run yet
    // on someone's Supabase project, this 404s/errors and we just show no
    // folders rather than breaking the whole documents panel.
    listFolders()
      .then(({ folders }) => setFolders(folders))
      .catch(() => {})
      .finally(() => setFoldersLoading(false));

    const timers = pollTimers.current;
    return () => {
      timers.forEach((t) => clearInterval(t));
    };
  }, []);

  const pollStatus = useCallback((documentId: string) => {
    if (pollTimers.current.has(documentId)) return;
    const timer = setInterval(async () => {
      try {
        const status = await getDocumentStatus(documentId);
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === documentId
              ? {
                  ...d,
                  status: status.status as DocumentSummary['status'],
                  chunkCount: status.chunkCount,
                  error: status.error,
                }
              : d
          )
        );
        if (status.status === 'ready' || status.status === 'failed') {
          clearInterval(timer);
          pollTimers.current.delete(documentId);
        }
      } catch {
        clearInterval(timer);
        pollTimers.current.delete(documentId);
      }
    }, POLL_INTERVAL_MS);
    pollTimers.current.set(documentId, timer);
  }, []);

  const upload = useCallback(
    async (file: File, folderId: string | null = null, allowDuplicate = false) => {
      setUploadError(null);
      try {
        const result = await uploadDocument(file, folderId, allowDuplicate);
        const optimisticDoc: DocumentSummary = {
          id: result.documentId,
          filename: result.filename,
          status: 'processing',
          chunkCount: 0,
          uploadedAt: new Date().toISOString(),
          folderId: folderId ?? null,
        };
        setDocuments((prev) => [optimisticDoc, ...prev]);
        pollStatus(result.documentId);
      } catch (err) {
        // A native confirm() here (rather than a custom modal) is a
        // deliberate, small trade-off - this is a rare edge case (an exact
        // re-upload), and a blocking yes/no prompt is the simplest correct
        // way to let someone override it without a whole new modal
        // component for something this infrequent.
        if (err instanceof ApiError && err.code === 'DUPLICATE_DOCUMENT') {
          const existing = err.details?.existingDocument as { filename: string; uploadedAt: string } | undefined;
          const detail = existing
            ? ` It looks identical to "${existing.filename}", uploaded ${new Date(existing.uploadedAt).toLocaleDateString()}.`
            : '';
          const proceed = window.confirm(`"${file.name}" appears to already be uploaded.${detail}\n\nUpload it again anyway?`);
          if (proceed) {
            await upload(file, folderId, true);
          }
          return;
        }
        setUploadError(err instanceof Error ? err.message : 'Upload failed.');
      }
    },
    [pollStatus]
  );

  const remove = useCallback(async (documentId: string) => {
    const previous = documentsRef.current;
    setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    try {
      await deleteDocument(documentId);
    } catch {
      setDocuments(previous);
    }
  }, []);

  const createFolder = useCallback(async (name: string) => {
    try {
      const { folder } = await apiCreateFolder(name);
      setFolders((prev) => [...prev, folder]);
      return folder;
    } catch {
      return null;
    }
  }, []);

  const deleteFolderFn = useCallback(async (folderId: string) => {
    const previousFolders = foldersRef.current;
    const previousDocs = documentsRef.current;
    // Optimistic: remove the folder and uncategorize its documents
    // immediately - matches what the DB's ON DELETE SET NULL will do.
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setDocuments((prev) => prev.map((d) => (d.folderId === folderId ? { ...d, folderId: null } : d)));
    try {
      await apiDeleteFolder(folderId);
    } catch {
      setFolders(previousFolders);
      setDocuments(previousDocs);
    }
  }, []);

  const moveToFolder = useCallback(async (documentId: string, folderId: string | null) => {
    const previous = documentsRef.current;
    setDocuments((prev) => prev.map((d) => (d.id === documentId ? { ...d, folderId } : d)));
    try {
      await moveDocumentToFolder(documentId, folderId);
    } catch {
      setDocuments(previous);
    }
  }, []);

  return (
    <DocumentsContext.Provider
      value={{
        documents,
        loading,
        loadError,
        uploadError,
        upload,
        remove,
        folders,
        foldersLoading,
        createFolder,
        deleteFolder: deleteFolderFn,
        moveToFolder,
      }}
    >
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments must be used within a DocumentsProvider');
  return ctx;
}
