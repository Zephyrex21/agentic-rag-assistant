import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { DocumentScopeBar } from './DocumentScopeBar';
import { MessageSkeleton } from '../ui/Skeleton';

export function ChatPanel() {
  const { activeConversationId, activeConversation, threadLoading, sending, sendError, sendMessage } =
    useConversations();
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation?.messages;
  const lastMessage = messages?.[messages.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    // lastMessage?.content.length is the key addition here - without it,
    // the view wouldn't auto-scroll as streamed text grows, since the
    // message COUNT doesn't change during streaming, only its content does.
  }, [messages?.length, lastMessage?.content.length, sending]);

  if (!activeConversationId) {
    return <EmptyState />;
  }

  return (
    <div className="flex h-full flex-col">
      <DocumentScopeBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
          {threadLoading && (
            <>
              <MessageSkeleton />
              <MessageSkeleton />
            </>
          )}

          <AnimatePresence initial={false}>
            {activeConversation?.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </AnimatePresence>

          {sendError && (
            <div className="flex items-center gap-2 rounded-xl bg-highlight/10 px-3.5 py-2.5 text-sm text-highlight">
              <AlertCircle size={14} className="shrink-0" />
              {sendError}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl">
        <Composer onSend={(text) => sendMessage(text)} disabled={sending} />
      </div>
    </div>
  );
}
