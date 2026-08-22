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
  // True when the source document has since been deleted - the excerpt/
  // fullText above are still the real snapshot from when this answer was
  // generated (nothing about the answer's content is wrong), this only
  // means the citation itself no longer points at anything you can open.
  // Set server-side at read time, not at delete time - see
  // conversationStore.js's annotateStaleCitations.
  documentDeleted?: boolean;
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
// there's a stage, its label, or how long it took. 'planning' only appears
// in agentic-mode traces (see PipelineTrace.agentic); every other key can
// appear in either mode.
export interface AgentStep {
  tool: 'search_documents' | 'list_documents' | string;
  query: string | null;
  chunksFound: number;
  rescueTriggered: boolean;
  durationMs: number;
}

export interface TraceStage {
  key: 'rewrite' | 'expansion' | 'retrieval' | 'dedup' | 'rerank' | 'generation' | 'verification' | 'planning';
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
    // dedup (fixed pipeline) / merge-dedup (agentic)
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
    researchOnRevision?: boolean;
    additionalStepsOnRevision?: AgentStep[];
    // planning (agentic mode only)
    skippedSearch?: boolean;
    totalSteps?: number;
    steps?: AgentStep[];
  };
}

export interface PipelineTrace {
  stages: TraceStage[];
  totalMs: number;
  noInfo?: boolean;
  // True when a tool-calling planner decided what/how many times to
  // search, instead of the fixed pipeline's always-exactly-once search.
  agentic?: boolean;
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
  phase?: 'searching' | 'streaming';
  // Persisted - whether this answer passed self-verification, and whether
  // it took an accepted revision to get there. `null` means verification
  // is enabled but still running in the background (see pendingRevision
  // below) - `undefined` means verification was disabled/not applicable.
  verified?: boolean | null;
  wasRevised?: boolean;
  // A background self-verification check found a problem and generated a
  // corrected answer - but it is only ever a SUGGESTION. The visible
  // `content` never changes on its own; a person has to explicitly accept
  // it (via useConversations().acceptRevision) for it to become the
  // message's actual content. Dismissing just clears this without
  // changing anything.
  pendingRevision?: {
    answer: string;
    sources: Source[];
    verified: boolean;
    issue: string;
  } | null;
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
