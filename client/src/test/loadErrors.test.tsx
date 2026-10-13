import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentsProvider } from '../context/DocumentsContext';
import { DocumentsPanel } from '../components/documents/DocumentsPanel';
import { ConversationsProvider } from '../context/ConversationsContext';
import { ConversationsPanel } from '../components/conversations/ConversationsPanel';
import { AuthProvider } from '../context/AuthContext';
import { ApiError, listDocuments, listFolders, listConversations } from '../lib/api';
import { UNREACHABLE_MESSAGE } from '../lib/errors';

// Keep the real ApiError class and everything else; only replace the network calls.
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    getMe: vi.fn(async () => ({ user: null, guestQueriesRemaining: null, guestQueryLimit: null })),
    listDocuments: vi.fn(),
    listFolders: vi.fn(async () => ({ folders: [] })),
    listConversations: vi.fn(),
  };
});
// The real helper waits ~1.2s before its one automatic retry; irrelevant here.
vi.mock('../lib/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }));

const mockedListDocuments = vi.mocked(listDocuments);
const mockedListFolders = vi.mocked(listFolders);
const mockedListConversations = vi.mocked(listConversations);

const RAW_RE = /TypeError|fetch failed|Failed to fetch|documentStore|conversationStore/i;

beforeEach(() => {
  vi.clearAllMocks();
  mockedListFolders.mockResolvedValue({ folders: [] });
});

function renderDocuments() {
  return render(
    <DocumentsProvider>
      <DocumentsPanel />
    </DocumentsProvider>
  );
}

function renderConversations() {
  return render(
    <AuthProvider>
      <ConversationsProvider>
        <ConversationsPanel />
      </ConversationsProvider>
    </AuthProvider>
  );
}

describe('DocumentsPanel - load failures', () => {
  it('shows a friendly message (not "Failed to fetch") when the server cannot be reached, with a Try again button', async () => {
    mockedListDocuments.mockRejectedValue(new TypeError('Failed to fetch'));
    renderDocuments();

    expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RAW_RE);
  });

  it('"Try again" reloads the documents and clears the error on success', async () => {
    const user = userEvent.setup();
    mockedListDocuments.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockedListDocuments.mockResolvedValueOnce({
      documents: [{ id: 'd1', filename: 'syllabus.pdf', status: 'ready', chunkCount: 4, uploadedAt: '2026-10-12T00:00:00Z', folderId: null }],
    });
    renderDocuments();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('syllabus.pdf')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(UNREACHABLE_MESSAGE)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(mockedListDocuments).toHaveBeenCalledTimes(2);
  });

  it('"Try again" keeps showing a friendly error if it fails again', async () => {
    const user = userEvent.setup();
    mockedListDocuments.mockRejectedValue(new TypeError('Failed to fetch'));
    renderDocuments();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(mockedListDocuments).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeInTheDocument();
  });

  it('cleans up raw text sent by an older server (mixed-version deploy)', async () => {
    mockedListDocuments.mockRejectedValue(new ApiError('documentStore.list failed: TypeError: fetch failed', 'LIST_FAILED', 500));
    renderDocuments();

    expect(await screen.findByText(/temporarily unreachable/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RAW_RE);
  });

  it('shows the friendly sentence a current server sends, as-is', async () => {
    mockedListDocuments.mockRejectedValue(
      new ApiError('The service is temporarily unreachable. It may be waking up - please try again in a moment.', 'SERVICE_UNAVAILABLE', 503)
    );
    renderDocuments();

    expect(await screen.findByText('The service is temporarily unreachable. It may be waking up - please try again in a moment.')).toBeInTheDocument();
  });

  it('shows no error banner at all when loading succeeds', async () => {
    mockedListDocuments.mockResolvedValue({ documents: [] });
    renderDocuments();

    await waitFor(() => expect(mockedListDocuments).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('ConversationsPanel - load failures', () => {
  it('shows a friendly message and a Try again button when the server cannot be reached', async () => {
    mockedListConversations.mockRejectedValue(new TypeError('Failed to fetch'));
    renderConversations();

    expect(await screen.findByText(UNREACHABLE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RAW_RE);
  });

  it('"Try again" reloads the conversations and clears the error on success', async () => {
    const user = userEvent.setup();
    mockedListConversations.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockedListConversations.mockResolvedValueOnce({ conversations: [{ id: 'c1', title: 'My CN syllabus chat', updatedAt: '2026-10-12T00:00:00Z' }] });
    renderConversations();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('My CN syllabus chat')).toBeInTheDocument();
    expect(screen.queryByText(UNREACHABLE_MESSAGE)).not.toBeInTheDocument();
    expect(mockedListConversations).toHaveBeenCalledTimes(2);
  });

  it('cleans up raw text sent by an older server', async () => {
    mockedListConversations.mockRejectedValue(new ApiError('conversationStore.listConversations failed: TypeError: fetch failed', 'LIST_FAILED', 500));
    renderConversations();

    expect(await screen.findByText(/temporarily unreachable/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RAW_RE);
  });
});
