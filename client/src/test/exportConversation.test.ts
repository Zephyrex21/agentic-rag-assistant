import { describe, it, expect } from 'vitest';
import { conversationToMarkdown } from '../lib/exportConversation';
import type { ConversationDetail } from '../lib/types';

function makeConversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: 'conv-1',
    title: 'What security features does Cryptex have?',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    ...overrides,
  };
}

describe('conversationToMarkdown', () => {
  it('includes the conversation title as an H1', () => {
    const md = conversationToMarkdown(makeConversation({ title: 'My Chat' }));
    expect(md).toContain('# My Chat');
  });

  it('renders a user message with the "You" label', () => {
    const md = conversationToMarkdown(
      makeConversation({
        messages: [{ id: 'm1', role: 'user', content: 'What is this about?', createdAt: '2026-01-01T00:00:00.000Z' }],
      })
    );
    expect(md).toContain('**You:**');
    expect(md).toContain('What is this about?');
  });

  it('renders an assistant message with the "Assistant" label', () => {
    const md = conversationToMarkdown(
      makeConversation({
        messages: [{ id: 'm1', role: 'assistant', content: 'It is a RAG assistant.', createdAt: '2026-01-01T00:00:00.000Z' }],
      })
    );
    expect(md).toContain('**Assistant:**');
    expect(md).toContain('It is a RAG assistant.');
  });

  it('lists only CITED sources, not every retrieved-but-unused source', () => {
    const md = conversationToMarkdown(
      makeConversation({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'Answer here.',
            createdAt: '2026-01-01T00:00:00.000Z',
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
              {
                sourceNumber: 2,
                cited: false,
                documentId: 'd2',
                filename: 'other.md',
                chunkIndex: 0,
                excerpt: '',
                fullText: '',
                relevanceScore: 0.4,
              },
            ],
          },
        ],
      })
    );
    expect(md).toContain('readme.md');
    expect(md).not.toContain('other.md');
  });

  it('omits the Sources block entirely when nothing was cited', () => {
    const md = conversationToMarkdown(
      makeConversation({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: "I don't have enough information.",
            createdAt: '2026-01-01T00:00:00.000Z',
            sources: [],
          },
        ],
      })
    );
    expect(md).not.toContain('*Sources:*');
  });

  it('notes a positive revision distinctly from an unresolved one', () => {
    const revisedOk = conversationToMarkdown(
      makeConversation({
        messages: [
          { id: 'm1', role: 'assistant', content: 'Fixed answer.', createdAt: '2026-01-01T00:00:00.000Z', wasRevised: true, verified: true },
        ],
      })
    );
    const revisedUnresolved = conversationToMarkdown(
      makeConversation({
        messages: [
          { id: 'm1', role: 'assistant', content: 'Uncertain answer.', createdAt: '2026-01-01T00:00:00.000Z', wasRevised: true, verified: false },
        ],
      })
    );
    expect(revisedOk).toContain('automatically revised for accuracy');
    expect(revisedUnresolved).toContain('may not be fully supported');
  });

  it('says nothing about revision when the answer was never revised', () => {
    const md = conversationToMarkdown(
      makeConversation({
        messages: [{ id: 'm1', role: 'assistant', content: 'Clean first-try answer.', createdAt: '2026-01-01T00:00:00.000Z' }],
      })
    );
    expect(md).not.toContain('revised');
  });

  it('produces well-formed output for a full back-and-forth conversation', () => {
    const md = conversationToMarkdown(
      makeConversation({
        title: 'Cryptex security',
        messages: [
          { id: 'm1', role: 'user', content: 'What security features does it have?', createdAt: '2026-01-01T00:00:00.000Z' },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Rate limiting and CORS.',
            createdAt: '2026-01-01T00:00:01.000Z',
            sources: [
              {
                sourceNumber: 1,
                cited: true,
                documentId: 'd1',
                filename: 'readme.md',
                section: 'Security',
                chunkIndex: 0,
                excerpt: '',
                fullText: '',
                relevanceScore: 0.9,
              },
            ],
          },
        ],
      })
    );
    expect(md.indexOf('What security features')).toBeLessThan(md.indexOf('Rate limiting'));
    expect(md).toContain('readme.md — Security');
  });
});
