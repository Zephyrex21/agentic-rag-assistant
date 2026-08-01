import type {
  ConversationDetail,
  ConversationSummary,
  DocumentSummary,
  Folder,
  Message,
  Source,
} from './types';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    const message = body?.error?.message || `Request failed with status ${res.status}`;
    const code = body?.error?.code || 'UNKNOWN_ERROR';
    throw new ApiError(message, code, res.status);
  }

  return body as T;
}

// ---------- Documents ----------

export async function uploadDocument(
  file: File,
  folderId?: string | null
): Promise<{ documentId: string; filename: string; status: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (folderId) formData.append('folderId', folderId);
  const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
  return handleResponse(res);
}

export async function getDocumentStatus(
  documentId: string
): Promise<{ documentId: string; status: string; chunkCount: number; error?: string }> {
  const res = await fetch(`/api/documents/${documentId}/status`);
  return handleResponse(res);
}

export async function listDocuments(): Promise<{ documents: DocumentSummary[] }> {
  const res = await fetch('/api/documents');
  return handleResponse(res);
}

export async function deleteDocument(documentId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/documents/${documentId}`, { method: 'DELETE' });
  return handleResponse(res);
}

export async function moveDocumentToFolder(
  documentId: string,
  folderId: string | null
): Promise<{ id: string; folderId: string | null }> {
  const res = await fetch(`/api/documents/${documentId}/folder`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderId }),
  });
  return handleResponse(res);
}

// ---------- Folders ----------

export async function listFolders(): Promise<{ folders: Folder[] }> {
  const res = await fetch('/api/folders');
  return handleResponse(res);
}

export async function createFolder(name: string): Promise<{ folder: Folder }> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return handleResponse(res);
}

export async function deleteFolder(folderId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
  return handleResponse(res);
}

// ---------- Conversations ----------

export async function createConversation(): Promise<{ conversationId: string; title: string }> {
  const res = await fetch('/api/conversations', { method: 'POST' });
  return handleResponse(res);
}

export async function listConversations(): Promise<{ conversations: ConversationSummary[] }> {
  const res = await fetch('/api/conversations');
  return handleResponse(res);
}

export async function getConversation(conversationId: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/conversations/${conversationId}`);
  return handleResponse(res);
}

export async function deleteConversation(conversationId: string): Promise<{ success: boolean }> {
  const res = await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
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
  verified?: boolean;
  wasRevised?: boolean;
}

export interface StreamCallbacks {
  onSources?: (sources: Source[]) => void;
  onChunk?: (text: string) => void;
  onRevising?: (issue: string) => void;
  onDone?: (result: StreamDoneResult) => void;
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
          else if (eventName === 'revising') callbacks.onRevising?.(data.issue);
          else if (eventName === 'chunk') callbacks.onChunk?.(data.text);
          else if (eventName === 'done') callbacks.onDone?.(data);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    callbacks.onError?.('Could not reach the server. Is it running?');
    return;
  }

  // Validation-type failures (missing question, 404, etc.) arrive as plain
  // JSON before the response ever switches into SSE mode.
  if (!res.ok) {
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
  return postStream(`/api/conversations/${conversationId}/messages`, { question, documentIds }, callbacks);
}

export function queryStream(
  question: string,
  documentIds: string[] | undefined,
  callbacks: StreamCallbacks
): Promise<void> {
  return postStream('/api/query', { question, documentIds }, callbacks);
}

export type { Message };
