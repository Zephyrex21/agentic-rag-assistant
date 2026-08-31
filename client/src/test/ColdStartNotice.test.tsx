import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../context/AuthContext';
import { ConversationsProvider } from '../context/ConversationsContext';
import { ColdStartNotice } from '../components/ColdStartNotice';

vi.stubEnv('VITE_COLD_START_THRESHOLD_MS', '30');

let resolveList: (() => void) | null = null;

vi.mock('../lib/api', () => ({
  // ConversationsProvider reads useAuth() now (for guestQueriesRemaining),
  // which boots from getMe() - not what this file is testing, so resolve
  // it immediately with "signed in, nothing guest-related".
  getMe: vi.fn(async () => ({ user: null, guestQueriesRemaining: null, guestQueryLimit: null })),
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

// ConversationsProvider now depends on AuthContext (see its own file) -
// wrap with AuthProvider here the same way App.tsx nests them for real.
function renderWithProviders(children: React.ReactNode) {
  return render(<AuthProvider><ConversationsProvider>{children}</ConversationsProvider></AuthProvider>);
}

describe('ColdStartNotice', () => {
  it('does not appear immediately while the initial load is still pending', () => {
    renderWithProviders(<ColdStartNotice />);
    expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument();
  });

  it('appears once the initial load has been pending past the cold-start threshold', async () => {
    renderWithProviders(<ColdStartNotice />);

    await waitFor(() => expect(screen.getByText(/waking up the server/i)).toBeInTheDocument());
  });

  it('disappears once the initial load actually resolves', async () => {
    renderWithProviders(<ColdStartNotice />);

    await waitFor(() => expect(screen.getByText(/waking up the server/i)).toBeInTheDocument());

    resolveList?.();

    await waitFor(() => expect(screen.queryByText(/waking up the server/i)).not.toBeInTheDocument());
  });
});
