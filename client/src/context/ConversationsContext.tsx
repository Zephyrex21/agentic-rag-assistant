import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  applyRevision as apiApplyRevision,
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getConversation,
  listConversations,
  sendMessageStream,
} from '../lib/api';
import type { ConversationDetail, ConversationSummary, Message } from '../lib/types';

interface ConversationsContextValue {
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  activeConversationId: string | null;
  activeConversation: ConversationDetail | null;
  threadLoading: boolean;
  sending: boolean;
  sendError: string | null;
  activeScope: string[];
  setActiveScope: (documentIds: string[]) => void;
  createConversation: () => Promise<void>;
  selectConversation: (id: string) => Promise<void>;
  sendMessage: (question: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  // Applies a background-verification suggestion (Message.pendingRevision)
  // as the message's new permanent content - a person's explicit choice,
  // never automatic. dismissRevision discards the suggestion instead,
  // leaving the original answer untouched either way.
  acceptRevision: (messageId: string) => Promise<void>;
  dismissRevision: (messageId: string) => void;
}

const ConversationsContext = createContext<ConversationsContextValue | undefined>(undefined);

function makeId() {
  // Optimistic-message placeholder IDs only - real IDs come from the server
  // and replace these once the request resolves.
  return `tmp_${Math.random().toString(36).slice(2)}`;
}

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ConversationDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Which documents each conversation is scoped to. Empty array = search
  // everything (the old, buggy default behavior). This is what actually
  // fixes "the assistant answered from the wrong document" - explicit scope
  // beats hoping the stale-document problem never comes up again.
  const [scopeByConversation, setScopeByConversation] = useState<Record<string, string[]>>({});

  const refreshList = useCallback(async () => {
    try {
      const { conversations } = await listConversations();
      setConversations(conversations);
    } catch {
      // Non-fatal - keep whatever list we already have
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const selectConversation = useCallback(async (id: string) => {
    setActiveConversationId(id);
    setThreadLoading(true);
    setSendError(null);
    try {
      const detail = await getConversation(id);
      setActiveConversation(detail);
    } catch {
      setActiveConversation(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const createConversation = useCallback(async () => {
    const { conversationId, title } = await apiCreateConversation();
    const newConvo: ConversationSummary = { id: conversationId, title, updatedAt: new Date().toISOString() };
    setConversations((prev) => [newConvo, ...prev]);
    setActiveConversationId(conversationId);
    setActiveConversation({ ...newConvo, createdAt: newConvo.updatedAt, messages: [] });
  }, []);

  const activeScope = (activeConversationId && scopeByConversation[activeConversationId]) || [];

  const setActiveScope = useCallback(
    (documentIds: string[]) => {
      if (!activeConversationId) return;
      setScopeByConversation((prev) => ({ ...prev, [activeConversationId]: documentIds }));
    },
    [activeConversationId]
  );

  const sendMessage = useCallback(
    async (question: string) => {
      if (!activeConversationId) return;
      setSendError(null);

      const optimisticUserMessage: Message = {
        id: makeId(),
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      };

      const streamingId = makeId();
      const streamingPlaceholder: Message = {
        id: streamingId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        isStreaming: true,
        phase: 'searching',
      };

      setActiveConversation((prev) =>
        prev ? { ...prev, messages: [...prev.messages, optimisticUserMessage, streamingPlaceholder] } : prev
      );
      setSending(true);

      const scope = scopeByConversation[activeConversationId];
      const documentIds = scope && scope.length > 0 ? scope : undefined;

      // Once `done` fires, the server-assigned message ID replaces the
      // temporary streaming one - later background events (`verified`,
      // `revision_available`) reference the server ID, so this needs to be
      // resolved before those arrive, not just captured once at closure time.
      let resolvedId = streamingId;

      const updateMessage = (id: string, updates: Partial<Message>) => {
        setActiveConversation((prev) =>
          prev ? { ...prev, messages: prev.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)) } : prev
        );
      };

      try {
        await sendMessageStream(activeConversationId, question, documentIds, {
          onSources: (sources) => {
            // Sources arriving is the signal that retrieval finished and
            // generation is starting - transition the UI from "searching" to
            // showing the actual streaming text.
            updateMessage(streamingId, { sources, phase: 'streaming' });
          },
          onChunk: (text) => {
            setActiveConversation((prev) =>
              prev
                ? {
                    ...prev,
                    messages: prev.messages.map((m) =>
                      m.id === streamingId ? { ...m, content: m.content + text, phase: 'streaming' } : m
                    ),
                  }
                : prev
            );
          },
          onDone: (result) => {
            // The answer is final right now - self-verification (if
            // enabled) continues in the background AFTER this and can only
            // ever attach a badge or a dismissible suggestion later, never
            // change what's already showing here.
            resolvedId = result.messageId || streamingId;
            updateMessage(streamingId, {
              id: resolvedId,
              content: result.answer,
              sources: result.sources,
              verified: result.verified,
              wasRevised: result.wasRevised,
              pipelineTrace: result.trace,
              isStreaming: false,
            });
            refreshList();
          },
          onVerified: (result) => {
            updateMessage(result.messageId || resolvedId, { verified: result.verified, pipelineTrace: result.trace });
          },
          onRevisionAvailable: (result) => {
            updateMessage(result.messageId || resolvedId, {
              pendingRevision: {
                answer: result.suggestedAnswer,
                sources: result.suggestedSources,
                verified: result.suggestedVerified,
                issue: result.issue,
              },
              pipelineTrace: result.trace,
            });
          },
          onError: (message) => {
            setSendError(message);
            // Roll back both the optimistic user message and the streaming
            // placeholder since the round-trip failed.
            setActiveConversation((prev) =>
              prev
                ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticUserMessage.id && m.id !== streamingId) }
                : prev
            );
          },
        });
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Something went wrong sending that.');
        setActiveConversation((prev) =>
          prev
            ? { ...prev, messages: prev.messages.filter((m) => m.id !== optimisticUserMessage.id && m.id !== streamingId) }
            : prev
        );
      } finally {
        setSending(false);
      }
    },
    [activeConversationId, refreshList, scopeByConversation]
  );

  const dismissRevision = useCallback((messageId: string) => {
    setActiveConversation((prev) =>
      prev
        ? { ...prev, messages: prev.messages.map((m) => (m.id === messageId ? { ...m, pendingRevision: null } : m)) }
        : prev
    );
  }, []);

  const acceptRevision = useCallback(
    async (messageId: string) => {
      if (!activeConversationId) return;
      const message = activeConversation?.messages.find((m) => m.id === messageId);
      const revision = message?.pendingRevision;
      if (!revision) return;

      // Applied optimistically (feels instant) - if the persistence call
      // below fails, the local swap still stands for this session; worst
      // case a later reload shows the original answer again, which is a
      // safe fallback, not a broken state.
      setActiveConversation((prev) =>
        prev
          ? {
              ...prev,
              messages: prev.messages.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      content: revision.answer,
                      sources: revision.sources,
                      verified: revision.verified,
                      wasRevised: true,
                      pendingRevision: null,
                    }
                  : m
              ),
            }
          : prev
      );

      try {
        await apiApplyRevision(activeConversationId, messageId, {
          content: revision.answer,
          sources: revision.sources,
          verified: revision.verified,
        });
      } catch {
        // Non-fatal - see comment above.
      }
    },
    [activeConversationId, activeConversation]
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      const previous = conversations;
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setActiveConversation(null);
      }
      setScopeByConversation((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        await apiDeleteConversation(id);
      } catch {
        setConversations(previous);
      }
    },
    [conversations, activeConversationId]
  );

  return (
    <ConversationsContext.Provider
      value={{
        conversations,
        conversationsLoading,
        activeConversationId,
        activeConversation,
        threadLoading,
        sending,
        sendError,
        activeScope,
        setActiveScope,
        createConversation,
        selectConversation,
        sendMessage,
        deleteConversation,
        acceptRevision,
        dismissRevision,
      }}
    >
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversations() {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used within a ConversationsProvider');
  return ctx;
}
