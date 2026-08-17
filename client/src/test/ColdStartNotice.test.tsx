import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConversationsProvider } from '../context/ConversationsContext';
import { ColdStartNotice } from '../components/ColdStartNotice';

vi.stubEnv('VITE_COLD_START_THRESHOLD_MS', '30');

let resolveList: (() => void) | null = null;

vi.mock('../lib/api', () => ({
  listConversations: vi.fn(
    () =>
      new Promise((resolve) => {
        resolveList = () => resolve({ conversations: [] });
      })
  ),
  createConversation: vi.fn(async () => ({ conversationId: 'c1', title: 'New conversation' })),
  getConversation: vi.fn(async () => ({ id: 'c1', title: 'New conversation', createdAt: '', messages: [] })),
  deleteConversation: vi.fn(async () => ({ success: true })),
  applyRevision: vi.fn(async () => ({})),
  sendMessageStream: vi.fn(async () => {}),
}));

describe('ColdStartNotice', () => {
  it('does not appear immediately while the initial load is still pending', () => {
    render(
      <ConversationsProvider>
        <ColdStartNotice />
      </ConversationsProvider>
    );
    expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument();
  });

  it('appears once the initial load has been pending past the cold-start threshold', async () => {
    render(
      <ConversationsProvider>
        <ColdStartNotice />
      </ConversationsProvider>
    );

    await waitFor(() => expect(screen.getByText(/waking up the server/i)).toBeInTheDocument());
  });

  it('disappears once the initial load actually resolves', async () => {
    render(
      <ConversationsProvider>
        <ColdStartNotice />
      </ConversationsProvider>
    );

    await waitFor(() => expect(screen.getByText(/waking up the server/i)).toBeInTheDocument());

    resolveList?.();

    await waitFor(() => expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument());
  });
});
