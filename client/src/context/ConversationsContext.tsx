import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
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

      const updateStreamingMessage = (updates: Partial<Message>) => {
        setActiveConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.map((m) => (m.id === streamingId ? { ...m, ...updates } : m)),
              }
            : prev
        );
      };

      try {
        await sendMessageStream(activeConversationId, question, documentIds, {
          onSources: (sources) => {
            // Sources arriving is the signal that retrieval finished and
            // generation is starting - transition the UI from "searching" to
            // showing the actual streaming text.
            updateStreamingMessage({ sources, phase: 'streaming' });
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
            updateStreamingMessage({
              id: result.messageId || streamingId,
              content: result.answer,
              sources: result.sources,
              isStreaming: false,
            });
            refreshList();
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
