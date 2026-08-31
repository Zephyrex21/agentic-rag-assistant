import { useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AlertCircle, Sparkles } from 'lucide-react';
import { useConversations } from '../../context/ConversationsContext';
import { useAuth } from '../../context/AuthContext';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { DocumentScopeBar } from './DocumentScopeBar';
import { MessageSkeleton } from '../ui/Skeleton';

export function ChatPanel() {
  const { activeConversationId, activeConversation, threadLoading, sending, sendError, sendMessage } =
    useConversations();
  const { user, guestQueriesRemaining } = useAuth();
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
        {/* Guest-only, and only once the free allowance is running low - a
            heads-up before the forced sign-in modal (see GuestLimitGate.tsx)
            rather than that modal being the person's first sign that guest
            mode was ever limited. Never shown for a signed-in user, whose
            guestQueriesRemaining is always null. */}
        {!user && guestQueriesRemaining !== null && guestQueriesRemaining <= 1 && (
          <div className="mb-2 flex items-center gap-2 rounded-xl px-3.5 py-2 text-[12.5px] text-ink-muted" style={{ background: 'color-mix(in srgb, var(--accent) 7%, transparent)' }}>
            <Sparkles size={13} className="shrink-0 text-accent" />
            {guestQueriesRemaining === 0
              ? "You've used your free guest questions — sign in to keep going."
              : "1 free guest question left after this one."}
          </div>
        )}
        <Composer onSend={(text) => sendMessage(text)} disabled={sending} />
      </div>
    </div>
  );
}
