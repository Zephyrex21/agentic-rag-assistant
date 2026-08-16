import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationsProvider, useConversations } from '../context/ConversationsContext';
import type { StreamCallbacks } from '../lib/api';

// A controllable "server" - lets the test decide exactly when each SSE
// event fires, independent of when the underlying promise resolves. This
// is what makes it possible to reproduce "background verification is still
// running" without a real timer/network.
let capturedCallbacks: StreamCallbacks | null = null;
let resolveStream: (() => void) | null = null;

vi.mock('../lib/api', () => ({
  listConversations: vi.fn(async () => ({ conversations: [] })),
  createConversation: vi.fn(async () => ({ conversationId: 'c1', title: 'New conversation' })),
  getConversation: vi.fn(async () => ({ id: 'c1', title: 'New conversation', createdAt: '', messages: [] })),
  deleteConversation: vi.fn(async () => ({ success: true })),
  applyRevision: vi.fn(async () => ({})),
  sendMessageStream: vi.fn((_conversationId: string, _question: string, _documentIds: string[] | undefined, callbacks: StreamCallbacks) => {
    capturedCallbacks = callbacks;
    // The promise deliberately does NOT resolve until the test explicitly
    // calls resolveStream() - simulating background verification still in
    // flight on the same connection after `done` has already fired.
    return new Promise<void>((resolve) => {
      resolveStream = resolve;
    });
  }),
}));

function TestHarness() {
  const { activeConversationId, sending, createConversation, selectConversation, sendMessage } = useConversations();
  return (
    <div>
      <button onClick={() => createConversation()}>create</button>
      <button onClick={() => selectConversation('c1')}>select</button>
      <button onClick={() => sendMessage('What is this about?')} disabled={sending}>
        send
      </button>
      <span data-testid="sending-state">{sending ? 'sending' : 'idle'}</span>
      <span data-testid="active-id">{activeConversationId ?? 'none'}</span>
    </div>
  );
}

describe('ConversationsContext - sending unblocks at done, not at stream close', () => {
  it('clears `sending` as soon as onDone fires, even while the underlying request is still open for background verification', async () => {
    const user = userEvent.setup();
    render(
      <ConversationsProvider>
        <TestHarness />
      </ConversationsProvider>
    );

    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('active-id')).toHaveTextContent('c1'));

    await user.click(screen.getByText('send'));
    await waitFor(() => expect(screen.getByTestId('sending-state')).toHaveTextContent('sending'));
    expect(screen.getByText('send')).toBeDisabled();

    // Simulate the server sending `done` - the answer is ready - while the
    // SSE connection stays open for background verification behind it.
    act(() => {
      capturedCallbacks?.onDone?.({
        messageId: 'm1',
        answer: 'The answer.',
        sources: [],
        verified: null,
        wasRevised: false,
      });
    });

    // This is the actual regression: sending must clear here, WITHOUT
    // waiting for the sendMessageStream promise to resolve (which in this
    // test never does until resolveStream() is called below, simulating
    // a slow/still-running background verification step).
    await waitFor(() => expect(screen.getByTestId('sending-state')).toHaveTextContent('idle'));
    expect(screen.getByText('send')).not.toBeDisabled();

    // Clean up the still-open mocked stream.
    resolveStream?.();
  });

  it('also clears `sending` on an error that arrives before done', async () => {
    const user = userEvent.setup();
    render(
      <ConversationsProvider>
        <TestHarness />
      </ConversationsProvider>
    );

    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('active-id')).toHaveTextContent('c1'));

    await user.click(screen.getByText('send'));
    await waitFor(() => expect(screen.getByTestId('sending-state')).toHaveTextContent('sending'));

    act(() => {
      capturedCallbacks?.onError?.('Something went wrong.');
    });

    await waitFor(() => expect(screen.getByTestId('sending-state')).toHaveTextContent('idle'));

    resolveStream?.();
  });
});