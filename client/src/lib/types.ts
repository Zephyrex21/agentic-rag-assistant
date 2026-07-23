export type DocumentStatus = 'processing' | 'ready' | 'failed';

export interface DocumentSummary {
  id: string;
  filename: string;
  status: DocumentStatus;
  chunkCount: number;
  uploadedAt: string;
  error?: string;
}

export interface Source {
  sourceNumber: number;
  cited: boolean;
  documentId: string;
  filename: string;
  chunkIndex: number;
  section?: string;
  excerpt: string;
  fullText: string;
  relevanceScore: number;
}

export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  conversationId?: string;
  role: MessageRole;
  content: string;
  sources?: Source[] | null;
  createdAt: string;
  // Streaming-only fields - never persisted, just drive the live UI while
  // an answer is being generated. `phase` lets the UI show "searching"
  // before any text exists, "streaming" while text arrives, and "revising"
  // if self-verification caught a problem and a corrected answer is
  // about to replace the current text.
  isStreaming?: boolean;
  phase?: 'searching' | 'streaming' | 'revising';
  revisionIssue?: string;
  // Persisted - whether this answer passed self-verification, and whether
  // it took a revision pass to get there. `verified` is undefined when
  // self-verification was disabled/not applicable, not just "unknown."
  verified?: boolean;
  wasRevised?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  createdAt: string;
  messages: Message[];
}

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
  };
}
