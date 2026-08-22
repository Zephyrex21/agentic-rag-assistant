import type {
  ConversationDetail,
  ConversationSummary,
  DocumentSummary,
  Folder,
  Message,
  PipelineTrace,
  Source,
} from './types';

/**
 * Empty by default - every call below becomes a plain relative `/api/...`
 * path, exactly as before. That's correct for local dev (Vite's proxy
 * handles it) AND for a production deploy where the frontend and backend
 * are served from the same origin (e.g. the backend serves the built
 * frontend, or the hosting platform rewrites /api/* to the backend).
 *
 * Set VITE_API_BASE_URL at build time (e.g. "https://your-api.onrender.com")
 * only if the frontend and backend are deployed to genuinely separate
 * domains - see the Deployment section in the README.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// --- Access key (APP_ACCESS_KEY on the backend, see server/src/middleware/auth.js) ---
//
// Opt-in on the backend: if the server operator never set APP_ACCESS_KEY,
// every request below sends an empty/absent header and the server simply
// never checks it - so a local dev setup (or anyone who hasn't set this
// up) behaves exactly as it did before this existed. Stored in
// localStorage (not a cookie) specifically so there's nothing for CSRF to
// exploit - it has to be attached explicitly by this client code, a
// third-party site can't make the browser send it automatically.
const ACCESS_KEY_STORAGE_KEY = 'app_access_key';

export function getAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY_STORAGE_KEY) || '';
  } catch {
    return ''; // localStorage can throw in some locked-down/private-browsing contexts
  }
}

export function setAccessKey(key: string): void {
  try {
    if (key) localStorage.setItem(ACCESS_KEY_STORAGE_KEY, key);
    else localStorage.removeItem(ACCESS_KEY_STORAGE_KEY);
  } catch {
    // Non-fatal - the key just won't persist across reloads in this context
  }
}

function authHeaders(): Record<string, string> {
  const key = getAccessKey();
  return key ? { 'X-App-Access-Key': key } : {};
}

// Fired whenever a request comes back 401 - a global listener (see
// AccessKeyGate.tsx) shows a prompt for the key without every individual
// call site needing to know about this. Deliberately a DOM event, not a
// React context, so plain fetch-based helpers here (outside any component)
// can raise it too.
const ACCESS_REQUIRED_EVENT = 'app-access-required';

function notifyAccessRequired() {
  window.dispatchEvent(new CustomEvent(ACCESS_REQUIRED_EVENT));
}

export function onAccessRequired(handler: () => void): () => void {
  window.addEventListener(ACCESS_REQUIRED_EVENT, handler);
  return () => window.removeEventListener(ACCESS_REQUIRED_EVENT, handler);
}

export class ApiError extends Error {
  code: string;
  status: number;
  // Arbitrary extra fields the backend attached to the error (e.g.
  // DUPLICATE_DOCUMENT's existingDocument) - see errorResponse()'s `extra`
  // param in routes/documents.js. Optional and untyped since which fields
  // are present depends entirely on `code`.
  details?: Record<string, unknown>;

  constructor(message: string, code: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401) notifyAccessRequired();
    const message = body?.error?.message || `Request failed with status ${res.status}`;
    const code = body?.error?.code || 'UNKNOWN_ERROR';
    const { code: _code, message: _message, ...details } = body?.error || {};
    throw new ApiError(message, code, res.status, Object.keys(details).length > 0 ? details : undefined);
  }

  return body as T;
}

// ---------- Documents ----------

export async function uploadDocument(
  file: File,
  folderId?: string | null,
  allowDuplicate?: boolean
): Promise<{ documentId: string; filename: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) formData.append('folderId', folderId);
  if (allowDuplicate) formData.append('allowDuplicate', 'true');
  // Deliberately no Content-Type header here - the browser sets
  // multipart/form-data with the correct boundary itself for FormData
  // bodies; only the access-key header is ours to add.
  const res = await fetch(`${API_BASE}/api/documents/upload`, { method: 'POST', body: formData, headers: authHeaders() });
  return handleResponse(res);
}

export async function getDocumentStatus(
  documentId: string
): Promise<{ documentId: string; status: string; chunkCount: number; error?: string }> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}/status`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function listDocuments(): Promise<{ documents: DocumentSummary[] }> {
  const res = await fetch(`${API_BASE}/api/documents`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function deleteDocument(documentId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}`, { method: 'DELETE', headers: authHeaders() });
  return handleResponse(res);
}

export async function moveDocumentToFolder(
  documentId: string,
  folderId: string | null
): Promise<{ id: string; folderId: string | null }> {
  const res = await fetch(`${API_BASE}/api/documents/${documentId}/folder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ folderId }),
  });
  return handleResponse(res);
}

// ---------- Folders ----------

export async function listFolders(): Promise<{ folders: Folder[] }> {
  const res = await fetch(`${API_BASE}/api/folders`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function createFolder(name: string): Promise<{ folder: Folder }> {
  const res = await fetch(`${API_BASE}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse(res);
}

export async function deleteFolder(folderId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/api/folders/${folderId}`, { method: 'DELETE', headers: authHeaders() });
  return handleResponse(res);
}

// ---------- Conversations ----------

export async function createConversation(): Promise<{ conversationId: string; title: string }> {
  const res = await fetch(`${API_BASE}/api/conversations`, { method: 'POST', headers: authHeaders() });
  return handleResponse(res);
}

export async function listConversations(): Promise<{ conversations: ConversationSummary[] }> {
  const res = await fetch(`${API_BASE}/api/conversations`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function deleteConversation(conversationId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}`, { method: 'DELETE', headers: authHeaders() });
  return handleResponse(res);
}

// ---------- Streaming (SSE) ----------
//
// Both /api/query and /api/conversations/:id/messages stream their answer
// via Server-Sent Events now, instead of returning one JSON blob after
// waiting for the full response. Pre-flight validation errors (missing
// question, unknown conversation) still arrive as plain JSON BEFORE the
// response switches into SSE mode - handled below by checking res.ok first.

export interface StreamDoneResult {
  messageId?: string;
  queryId?: string;
  answer: string;
  sources: Source[];
  // null = self-verification is enabled but still running in the
  // background (see onVerified/onRevisionAvailable below) - the answer
  // itself is already final either way.
  verified?: boolean | null;
  wasRevised?: boolean;
  trace?: PipelineTrace | null;
}

export interface StreamVerifiedResult {
  messageId?: string;
  verified: boolean;
  trace?: PipelineTrace | null;
}

export interface StreamRevisionAvailableResult {
  messageId?: string;
  suggestedAnswer: string;
  suggestedSources: Source[];
  suggestedVerified: boolean;
  issue: string;
  trace?: PipelineTrace | null;
}

export interface StreamCallbacks {
  onSources?: (sources: Source[]) => void;
  onChunk?: (text: string) => void;
  onDone?: (result: StreamDoneResult) => void;
  // Background self-verification finished after `onDone` already fired -
  // the visible answer never changes for either of these, only its
  // verified flag/trace (onVerified) or a dismissible suggestion
  // (onRevisionAvailable). See rag.js's retrieveAndAnswerStream for why
  // this never auto-replaces what's already shown.
  onVerified?: (result: StreamVerifiedResult) => void;
  onRevisionAvailable?: (result: StreamRevisionAvailableResult) => void;
  onError?: (message: string) => void;
}

async function consumeSseStream(res: Response, callbacks: StreamCallbacks) {
  if (!res.body) {
    callbacks.onError?.('No response body received.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line; each event has "event: name"
    // and "data: {...}" lines within it.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = 'message';
      let dataLine = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLine = line.slice(6);
      }

      if (dataLine) {
        try {
          const data = JSON.parse(dataLine);
          if (eventName === 'sources') callbacks.onSources?.(data.sources);
          else if (eventName === 'chunk') callbacks.onChunk?.(data.text);
          else if (eventName === 'done') callbacks.onDone?.(data);
          else if (eventName === 'verified') callbacks.onVerified?.(data);
          else if (eventName === 'revision_available') callbacks.onRevisionAvailable?.(data);
          else if (eventName === 'error') callbacks.onError?.(data.message);
        } catch {
          // malformed event - skip it rather than breaking the whole stream
        }
      }

      boundary = buffer.indexOf('\n\n');
    }
  }
}

async function postStream(url: string, body: object, callbacks: StreamCallbacks) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    callbacks.onError?.('Could not reach the server. Is it running?');
    return;
  }

  // Validation-type failures (missing question, 404, etc.) arrive as plain
  // JSON before the response ever switches into SSE mode.
  if (!res.ok) {
    if (res.status === 401) notifyAccessRequired();
    const errBody = await res.json().catch(() => null);
    callbacks.onError?.(errBody?.error?.message || `Request failed with status ${res.status}`);
    return;
  }

  await consumeSseStream(res, callbacks);
}

export function sendMessageStream(
  conversationId: string,
  question: string,
  documentIds: string[] | undefined,
  callbacks: StreamCallbacks
): Promise<void> {
  return postStream(`${API_BASE}/api/conversations/${conversationId}/messages`, { question, documentIds }, callbacks);
}

export function queryStream(
  question: string,
  documentIds: string[] | undefined,
  callbacks: StreamCallbacks
): Promise<void> {
  return postStream(`${API_BASE}/api/query`, { question, documentIds }, callbacks);
}

/**
 * Accepts a suggested revision (from onRevisionAvailable) as a message's
 * new, permanent content - the one moment a suggestion actually gets
 * written anywhere. Only meaningful for conversation-backed messages
 * (stateless /api/query has nothing to persist against); the caller is
 * responsible for updating local UI state either way.
 */
export async function applyRevision(
  conversationId: string,
  messageId: string,
  revision: { content: string; sources: Source[]; verified: boolean }
): Promise<Message> {
  const res = await fetch(`${API_BASE}/api/conversations/${conversationId}/messages/${messageId}/revision`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(revision),
  });
  return handleResponse(res);
}

export type { Message };
