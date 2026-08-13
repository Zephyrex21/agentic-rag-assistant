import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnswerText } from '../components/citations/AnswerText';
import type { Source } from '../lib/types';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => ({ svg: `<svg data-testid="rendered-diagram"><text>${code}</text></svg>` })),
  },
}));

const sources: Source[] = [
  {
    sourceNumber: 1,
    cited: true,
    documentId: 'd1',
    filename: 'cryptex.md',
    chunkIndex: 0,
    excerpt: 'excerpt',
    fullText: 'full text',
    relevanceScore: 0.9,
  },
];

describe('AnswerText', () => {
  it('routes a ```mermaid fenced block to an actual rendered diagram, not a plain code block', async () => {
    const content = '```mermaid\ngraph TD; A-->B;\n```';
    const { container } = render(<AnswerText content={content} sources={sources} />);
    await waitFor(() => expect(container.querySelector('svg[data-testid="rendered-diagram"]')).toBeInTheDocument());
    // The raw mermaid source should NOT appear as literal code-block text once rendered
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('still renders a non-mermaid fenced code block as a plain code block', () => {
    const content = '```javascript\nconst x = 1;\n```';
    const { container } = render(<AnswerText content={content} sources={sources} />);
    expect(container.querySelector('pre code')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders a markdown table with proper structure', () => {
    const content = '| Feature | Status |\n|---|---|\n| Rate limiting | Enabled |';
    render(<AnswerText content={content} sources={sources} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Rate limiting')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('renders a citation badge correctly inside a table cell', () => {
    const content = '| Feature | Source |\n|---|---|\n| Rate limiting | (Source 1) |';
    const { container } = render(<AnswerText content={content} sources={sources} />);
    // The citation badge renders as a numbered link element, not literal "(Source 1)" text
    expect(screen.queryByText('(Source 1)')).not.toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  it('renders headers and bold text with the expected structure', () => {
    const content = '## Overview\n\nCryptex has **strong security** features.';
    render(<AnswerText content={content} sources={sources} />);
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('strong security').tagName).toBe('STRONG');
  });
});
