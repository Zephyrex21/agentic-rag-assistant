import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { deleteDocument, getDocumentStatus, listDocuments, uploadDocument } from '../lib/api';
import type { DocumentSummary } from '../lib/types';

const POLL_INTERVAL_MS = 2000;

interface DocumentsContextValue {
  documents: DocumentSummary[];
  loading: boolean;
  uploadError: string | null;
  upload: (file: File) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | undefined>(undefined);

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  useEffect(() => {
    listDocuments()
      .then(({ documents }) => setDocuments(documents))
      .catch(() => {})
      .finally(() => setLoading(false));

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
    async (file: File) => {
      setUploadError(null);
      try {
        const result = await uploadDocument(file);
        const optimisticDoc: DocumentSummary = {
          id: result.documentId,
          filename: result.filename,
          status: 'processing',
          chunkCount: 0,
          uploadedAt: new Date().toISOString(),
        };
        setDocuments((prev) => [optimisticDoc, ...prev]);
        pollStatus(result.documentId);
      } catch (err) {
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

  return (
    <DocumentsContext.Provider value={{ documents, loading, uploadError, upload, remove }}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  const ctx = useContext(DocumentsContext);
  if (!ctx) throw new Error('useDocuments must be used within a DocumentsProvider');
  return ctx;
}
