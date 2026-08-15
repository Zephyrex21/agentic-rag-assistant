import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { Message } from '../lib/types';

const acceptRevision = vi.fn();
const dismissRevision = vi.fn();

// MessageBubble reads acceptRevision/dismissRevision from context - mocked
// directly rather than wrapping every test in a real ConversationsProvider,
// which would fire a real fetch() on mount. Same "swap the boundary for a
// controllable fake" approach used elsewhere (mermaid, route test mocks).
vi.mock('../context/ConversationsContext', () => ({
  useConversations: () => ({ acceptRevision, dismissRevision }),
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'This is the answer.',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MessageBubble', () => {
  it('renders a user message as plain content', () => {
    render(<MessageBubble message={makeMessage({ role: 'user', content: 'What is this about?' })} />);
    expect(screen.getByText('What is this about?')).toBeInTheDocument();
  });

  it('renders assistant markdown content', () => {
    render(<MessageBubble message={makeMessage({ content: 'This has **bold** text.' })} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  it('renders a citation badge for a cited source, using the source number as its label', () => {
    render(
      <MessageBubble
        message={makeMessage({
          content: 'Cryptex uses rate limiting. (Source 1)',
          sources: [
            {
              sourceNumber: 1,
              cited: true,
              documentId: 'd1',
              filename: 'readme.md',
              chunkIndex: 0,
              excerpt: '',
              fullText: '',
              relevanceScore: 0.9,
            },
          ],
        })}
      />
    );
    expect(screen.getByRole('button', { name: /show source 1/i })).toBeInTheDocument();
  });

  it('shows the "revised for accuracy" badge only when verified after a revision', () => {
    render(<MessageBubble message={makeMessage({ wasRevised: true, verified: true })} />);
    expect(screen.getByText(/revised for accuracy/i)).toBeInTheDocument();
  });

  it('shows the "may not be fully supported" badge when still unverified after a revision', () => {
    render(<MessageBubble message={makeMessage({ wasRevised: true, verified: false })} />);
    expect(screen.getByText(/may not be fully supported/i)).toBeInTheDocument();
  });

  it('shows no verification badge at all when the answer was never revised', () => {
    render(<MessageBubble message={makeMessage({ wasRevised: false, verified: true })} />);
    expect(screen.queryByText(/revised for accuracy/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may not be fully supported/i)).not.toBeInTheDocument();
  });

  it('shows a cited-source count summary', () => {
    render(
      <MessageBubble
        message={makeMessage({
          content: 'Answer. (Source 1)',
          sources: [
            {
              sourceNumber: 1,
              cited: true,
              documentId: 'd1',
              filename: 'a.md',
              chunkIndex: 0,
              excerpt: '',
              fullText: '',
              relevanceScore: 0.9,
            },
          ],
        })}
      />
    );
    expect(screen.getByText(/1 source used/i)).toBeInTheDocument();
  });
});

describe('MessageBubble - revision suggestions', () => {
  const pendingRevision = {
    answer: 'This is the corrected answer. (Source 1)',
    sources: [
      {
        sourceNumber: 1,
        cited: true,
        documentId: 'd1',
        filename: 'readme.md',
        chunkIndex: 0,
        excerpt: '',
        fullText: '',
        relevanceScore: 0.9,
      },
    ],
    verified: true,
    issue: 'A number in the original answer was not supported by the sources.',
  };

  it('never changes the visible answer just because a revision is pending - the original stays shown', () => {
    render(<MessageBubble message={makeMessage({ content: 'Original answer text.', pendingRevision })} />);
    expect(screen.getByText('Original answer text.')).toBeInTheDocument();
    expect(screen.queryByText(/This is the corrected answer/)).not.toBeInTheDocument();
  });

  it('shows a dismissible suggestion pill when a revision is pending', () => {
    render(<MessageBubble message={makeMessage({ pendingRevision })} />);
    expect(screen.getByText(/possible improvement/i)).toBeInTheDocument();
  });

  it('shows no suggestion pill when there is no pending revision', () => {
    render(<MessageBubble message={makeMessage({ pendingRevision: null })} />);
    expect(screen.queryByText(/possible improvement/i)).not.toBeInTheDocument();
  });

  it('opens a modal with the suggested answer and the reason when "Review" is clicked', async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={makeMessage({ pendingRevision })} />);
    await user.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText('Suggested improvement')).toBeInTheDocument();
    expect(screen.getByText(/A number in the original answer was not supported/)).toBeInTheDocument();
  });

  it('calls acceptRevision with the message id when "Use this version" is clicked', async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={makeMessage({ id: 'm-target', pendingRevision })} />);
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(screen.getByRole('button', { name: /use this version/i }));
    expect(acceptRevision).toHaveBeenCalledWith('m-target');
  });

  it("calls dismissRevision with the message id when the pill's dismiss button is clicked, without opening the modal", async () => {
    const user = userEvent.setup();
    render(<MessageBubble message={makeMessage({ id: 'm-target', pendingRevision })} />);
    await user.click(screen.getByRole('button', { name: /dismiss suggestion/i }));
    expect(dismissRevision).toHaveBeenCalledWith('m-target');
    expect(screen.queryByText('Suggested improvement')).not.toBeInTheDocument();
  });
});
