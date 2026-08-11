export type DocumentStatus = 'processing' | 'ready' | 'failed';

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface DocumentSummary {
  id: string;
  filename: string;
  status: DocumentStatus;
  chunkCount: number;
  uploadedAt: string;
  error?: string;
  folderId: string | null;
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

// --- Pipeline observability ---
//
// A lightweight reference to a chunk (never the full text) - used in the
// rerank stage's "kept"/"dropped" lists in the Inspector panel.
export interface TraceChunkRef {
  filename: string;
  section?: string;
  chunkIndex: number;
}

// Every stage has the same shape - the Inspector renders each one with a
// `key`-specific detail view, but doesn't need special-casing to know
// there's a stage, its label, or how long it took.
export interface TraceStage {
  key: 'rewrite' | 'expansion' | 'retrieval' | 'dedup' | 'rerank' | 'generation' | 'verification';
  label: string;
  durationMs: number;
  data: {
    // rewrite
    enabled?: boolean;
    original?: string;
    rewritten?: string;
    changed?: boolean;
    // expansion
    variants?: string[];
    // retrieval
    queryVariantCount?: number;
    hybridSearchEnabled?: boolean;
    vectorHits?: number;
    keywordHits?: number;
    fusedCandidates?: number;
    candidatesConsidered?: number;
    // dedup
    before?: number;
    after?: number;
    removed?: number;
    // rerank
    candidatesIn?: number;
    topK?: number;
    baseTopK?: number;
    adaptiveTopKApplied?: boolean;
    kept?: TraceChunkRef[];
    dropped?: TraceChunkRef[];
    rescueTriggered?: boolean;
    // generation
    chunksUsed?: number;
    answerLength?: number;
    // verification
    passed?: boolean;
    issue?: string | null;
    wasRevised?: boolean;
    revisionGenerationMs?: number;
  };
}

export interface PipelineTrace {
  stages: TraceStage[];
  totalMs: number;
  noInfo?: boolean;
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
  // Persisted - a stage-by-stage record of what the pipeline did to
  // produce this answer. Undefined/null when pipeline tracing was
  // disabled, or for messages created before this feature existed.
  pipelineTrace?: PipelineTrace | null;
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
