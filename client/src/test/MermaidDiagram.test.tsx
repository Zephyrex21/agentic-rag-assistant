import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MermaidDiagram } from '../components/citations/MermaidDiagram';

// Mermaid's real rendering does DOM measurement work jsdom can't fully
// replicate, and we're testing OUR component's success/failure handling,
// not mermaid's own rendering correctness - so it's mocked deterministically,
// same reasoning as mocking rag.retrieveAndAnswerStream in the backend
// route tests rather than exercising the real thing.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => {
      if (code.includes('BROKEN')) throw new Error('invalid mermaid syntax');
      return { svg: `<svg data-testid="rendered-diagram"><text>${code}</text></svg>` };
    }),
  },
}));

describe('MermaidDiagram', () => {
  it('shows a loading placeholder before the diagram resolves', () => {
    render(<MermaidDiagram code="graph TD; A-->B;" />);
    expect(screen.getByLabelText('Rendering diagram')).toBeInTheDocument();
  });

  it('renders the diagram SVG once mermaid resolves successfully', async () => {
    const { container } = render(<MermaidDiagram code="graph TD; A-->B;" />);
    await waitFor(() => expect(container.querySelector('svg[data-testid="rendered-diagram"]')).toBeInTheDocument());
  });

  it('falls back to a plain code block when mermaid rendering fails, instead of breaking', async () => {
    render(<MermaidDiagram code="BROKEN nonsense that is not valid mermaid" />);
    await waitFor(() => expect(screen.getByText('BROKEN nonsense that is not valid mermaid')).toBeInTheDocument());
  });

  it('re-renders when the code prop changes', async () => {
    const { container, rerender } = render(<MermaidDiagram code="graph TD; A-->B;" />);
    await waitFor(() => expect(container.querySelector('svg')).toBeInTheDocument());

    rerender(<MermaidDiagram code="graph TD; C-->D;" />);
    await waitFor(() => expect(container.textContent).toContain('C-->D'));
  });
});
