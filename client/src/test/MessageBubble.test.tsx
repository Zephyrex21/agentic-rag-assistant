import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '../components/chat/MessageBubble';
import type { Message } from '../lib/types';

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

  it('shows the previous answer dimmed (not gone) while a revision is in progress', () => {
    render(
      <MessageBubble
        message={makeMessage({
          isStreaming: true,
          phase: 'revising',
          content: '',
          previousContent: 'This is the original answer being double-checked.',
        })}
      />
    );
    // The old answer is still visible in the DOM, not wiped - just dimmed via
    // the opacity-40 wrapper, so the revision doesn't read as the app losing
    // its own answer.
    expect(screen.getByText('This is the original answer being double-checked.')).toBeInTheDocument();
    expect(screen.getByText(/double-checking this answer/i)).toBeInTheDocument();
  });

  it('shows only the revising indicator, with no dimmed answer, on the very first attempt (no previous content yet)', () => {
    render(<MessageBubble message={makeMessage({ isStreaming: true, phase: 'revising', content: '', previousContent: undefined })} />);
    expect(screen.getByText(/double-checking this answer/i)).toBeInTheDocument();
  });
});
