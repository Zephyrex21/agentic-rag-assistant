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

// --- Guest identity (server: middleware/guestQueryLimit.js) ---
//
// A header + localStorage id, NOT a cookie - deliberately, same reasoning
// as the access key above. This app's frontend/backend are commonly
// deployed on separate domains (see README's Deployment section), and a
// cookie set by the backend in that shape is a third-party cookie from
// the browser's point of view: SameSite=Lax blocks it from ever being
// sent back on cross-site fetch requests at all, and even SameSite=None
// runs into Safari's ITP and Chrome's third-party-cookie restrictions.
// A plain header this client attaches itself sidesteps all of that.
const GUEST_ID_STORAGE_KEY = 'rag_guest_id';
const GUEST_ID_HEADER = 'X-Guest-Id';

function getGuestId(): string {
  try {
    let id = localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(GUEST_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    // localStorage can throw in some locked-down/private-browsing contexts
    // (same as getAccessKey above) - a guest in that situation simply
    // isn't tracked for the free-question limit, they aren't blocked from
    // using the app.
    return '';
  }
}

// --- Session token (server: middleware/userAuth.js, routes/auth.js) ---
//
// A header + localStorage token, NOT (solely) a cookie - same reasoning as
// the guest id above, but this one matters even more: it's what
// distinguishes a signed-in person from a guest at all. The account
// session cookie (COOKIE_NAME='session' server-side) is SameSite=Lax,
// which reliably works for a same-origin deployment but is silently never
// sent back on a cross-site fetch in this app's other common deployment
// shape (frontend/backend on separate domains) - meaning someone could
// verify an OTP code successfully, get a cookie set, reload, and still
// show up as a guest, because the reload's own request never included it.
// Storing the token returned by /otp/verify here and sending it as
// `Authorization: Bearer <token>` sidesteps that entirely.
const SESSION_TOKEN_STORAGE_KEY = 'rag_session_token';

export function getSessionToken(): string {
  try {
    return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || '';
  } catch {
    return ''; // localStorage can throw in some locked-down/private-browsing contexts
  }
}

export function setSessionToken(token: string): void {
  try {
    if (token) localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
  } catch {
    // Non-fatal - same as setAccessKey above, just won't persist here
  }
}

function authHeaders(): Record<string, string> {
  const key = getAccessKey();
  const guestId = getGuestId();
  const sessionToken = getSessionToken();
  return {
    ...(key ? { 'X-App-Access-Key': key } : {}),
    ...(guestId ? { [GUEST_ID_HEADER]: guestId } : {}),
    ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
  };
}

// credentials: 'include' on every call below - required for the user-
// account session cookie (see server/src/routes/auth.js) to actually be
// sent/received. Harmless for guests (no cookie exists yet, so this is a
// no-op) and for same-origin/local-dev setups (the browser already sends
// same-origin cookies regardless) - it only matters once the frontend and
// backend are on separate domains with a real ALLOWED_ORIGIN configured
// (see app.js's CORS comment for the other half of that setup).
const CREDENTIALS: RequestCredentials = 'include';

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

// Fired whenever a request comes back 403 with code GUEST_LIMIT_REACHED
// (see server/src/middleware/guestQueryLimit.js) - a global listener (see
// GuestLimitGate.tsx) forces the sign-in modal open, the same event-bus
// pattern as ACCESS_REQUIRED_EVENT above.
const GUEST_LIMIT_EVENT = 'app-guest-limit-reached';

function notifyGuestLimitReached() {
  window.dispatchEvent(new CustomEvent(GUEST_LIMIT_EVENT));
}

export function onGuestLimitReached(handler: () => void): () => void {
  window.addEventListener(GUEST_LIMIT_EVENT, handler);
  return () => window.removeEventListener(GUEST_LIMIT_EVENT, handler);
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

// Render's free tier (this app's typical backend host) spins the server
// down after inactivity, and waking it back up can take up to roughly a
// minute (see ColdStartNotice.tsx) - long enough that plain fetch(), which
// has no timeout of its own, can leave a "Sending..." button sitting there
// indefinitely if something is ACTUALLY wrong (dropped connection, server
// genuinely hung) rather than just cold. 75s comfortably covers a real
// cold start while still guaranteeing every request eventually settles
// one way or another instead of hanging forever with no recovery.
//
// Deliberately NOT used for the SSE streaming connection in postStream()
// below - once that fetch's promise resolves and the response starts
// streaming, the same AbortController would tear down an in-progress
// generation the moment this timer fired, which could easily be longer
// than 75s for a multi-step agentic answer. A stuck STREAMING connection
// is a different problem with a different fix, not this one.
const REQUEST_TIMEOUT_MS = 75000;

async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        "This is taking longer than expected. The server may still be waking up (free hosting tiers can take up to a minute to start) - please try again.",
        'REQUEST_TIMEOUT',
        0
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    if (res.status === 401) notifyAccessRequired();
    const code = body?.error?.code || 'UNKNOWN_ERROR';
    if (code === 'GUEST_LIMIT_REACHED') notifyGuestLimitReached();
    const message = body?.error?.message || `Request failed with status ${res.status}`;
    const { code: _code, message: _message, ...details } = body?.error || {};
    throw new ApiError(message, code, res.status, Object.keys(details).length > 0 ? details : undefined);
  }

  return body as T;
}

// ---------- Account (passwordless email-OTP sign-in) ----------
//
// Guest mode needs none of this - every call above/below already works
// with no session cookie at all, scoped to the shared guest pool exactly
// as this app always worked (see server/src/middleware/userAuth.js).
//
// Two-step, not signup vs. login - there's only ever one flow: request a
// code for an email, then verify it. The account is created transparently
// on a first-time email's successful verify (see server/src/routes/auth.js).

export interface AccountUser {
  id: string;
  email: string;
}

export async function requestOtp(email: string): Promise<{ sent: boolean; expiresInSeconds: number }> {
  const res = await apiFetch(`${API_BASE}/api/auth/otp/request`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email }),
  });
  return handleResponse(res);
}

export async function verifyOtp(email: string, code: string): Promise<{ user: AccountUser }> {
  const res = await apiFetch(`${API_BASE}/api/auth/otp/verify`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ email, code }),
  });
  const result = await handleResponse<{ user: AccountUser; token: string }>(res);
  // Stored immediately (before returning) so it's already in place for the
  // very next call this triggers - see AuthContext.verifyOtp, which
  // reloads the page right after this resolves. See getSessionToken's own
  // comment for why this needs to be a header/localStorage token at all,
  // not just the cookie the server also sets alongside it.
  setSessionToken(result.token);
  return { user: result.user };
}

export async function logout(): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  const result = await handleResponse<{ success: boolean }>(res);
  // Cleared regardless of the response - there's no scenario where keeping
  // a stale token around after asking to log out is the right call, even
  // if the server-side cookie-clear itself somehow failed.
  setSessionToken('');
  return result;
}

export interface OAuthProviders {
  google: boolean;
  github: boolean;
}

export async function getMe(): Promise<{
  user: AccountUser | null;
  // Both null for a signed-in user - only meaningful for a guest. See
  // server/src/middleware/guestQueryLimit.js.
  guestQueriesRemaining: number | null;
  guestQueryLimit: number | null;
  // Which OAuth providers this deployment actually has credentials for -
  // see server/src/services/oauthProviders.js. Used to only render a
  // "Continue with X" button for a provider that will actually work.
  oauthProviders: OAuthProviders;
}> {
  const res = await apiFetch(`${API_BASE}/api/auth/me`, { credentials: CREDENTIALS, headers: authHeaders() });
  return handleResponse(res);
}

// Not a fetch() call - this is meant to be assigned straight to
// window.location.href (see AuthModal.tsx), a real top-level browser
// navigation through the OAuth provider and back (see
// server/src/routes/oauth.js). authHeaders() has no way to attach itself
// to a navigation the way it does every other call in this file, which is
// exactly why that whole route is mounted ahead of the access-key gate
// server-side - see app.js's comment at that mount point.
export function getOAuthUrl(provider: keyof OAuthProviders): string {
  return `${API_BASE}/api/auth/oauth/${provider}`;
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
  const res = await apiFetch(`${API_BASE}/api/documents/upload`, {
    method: 'POST',
    credentials: CREDENTIALS,
    body: formData,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function getDocumentStatus(
  documentId: string
): Promise<{ documentId: string; status: string; chunkCount: number; error?: string }> {
  const res = await apiFetch(`${API_BASE}/api/documents/${documentId}/status`, {
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function listDocuments(): Promise<{ documents: DocumentSummary[] }> {
  const res = await apiFetch(`${API_BASE}/api/documents`, { credentials: CREDENTIALS, headers: authHeaders() });
  return handleResponse(res);
}

export async function deleteDocument(documentId: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/documents/${documentId}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function moveDocumentToFolder(
  documentId: string,
  folderId: string | null
): Promise<{ id: string; folderId: string | null }> {
  const res = await apiFetch(`${API_BASE}/api/documents/${documentId}/folder`, {
    method: 'PATCH',
    credentials: CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ folderId }),
  });
  return handleResponse(res);
}

// ---------- Folders ----------

export async function listFolders(): Promise<{ folders: Folder[] }> {
  const res = await apiFetch(`${API_BASE}/api/folders`, { credentials: CREDENTIALS, headers: authHeaders() });
  return handleResponse(res);
}

export async function createFolder(name: string): Promise<{ folder: Folder }> {
  const res = await apiFetch(`${API_BASE}/api/folders`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse(res);
}

export async function deleteFolder(folderId: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/folders/${folderId}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ---------- Conversations ----------

export async function createConversation(): Promise<{ conversationId: string; title: string }> {
  const res = await apiFetch(`${API_BASE}/api/conversations`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function listConversations(): Promise<{ conversations: ConversationSummary[] }> {
  const res = await apiFetch(`${API_BASE}/api/conversations`, { credentials: CREDENTIALS, headers: authHeaders() });
  return handleResponse(res);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  const res = await apiFetch(`${API_BASE}/api/conversations/${conversationId}`, {
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function deleteConversation(conversationId: string): Promise<{ success: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/conversations/${conversationId}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
    headers: authHeaders(),
  });
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
  // null for a signed-in user; for a guest, how many free questions are
  // left after this one. See server/src/middleware/guestQueryLimit.js.
  guestQueriesRemaining?: number | null;
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
      credentials: CREDENTIALS,
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
    if (errBody?.error?.code === 'GUEST_LIMIT_REACHED') notifyGuestLimitReached();
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
  const res = await apiFetch(`${API_BASE}/api/conversations/${conversationId}/messages/${messageId}/revision`, {
    method: 'PATCH',
    credentials: CREDENTIALS,
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(revision),
  });
  return handleResponse(res);
}

export type { Message };
