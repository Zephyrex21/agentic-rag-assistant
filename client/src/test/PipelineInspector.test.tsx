import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PipelineInspectorTrigger } from '../components/inspector/PipelineInspector';
import type { PipelineTrace } from '../lib/types';

function makeTrace(overrides: Partial<PipelineTrace> = {}): PipelineTrace {
  return {
    totalMs: 1850,
    noInfo: false,
    stages: [
      {
        key: 'rewrite',
        label: 'Query Rewrite',
        durationMs: 120,
        data: { enabled: true, original: 'what about it', rewritten: 'What is Cryptex?', changed: true },
      },
      {
        key: 'expansion',
        label: 'Query Expansion',
        durationMs: 140,
        data: { enabled: true, variants: ['What does Cryptex do?', 'Cryptex overview'] },
      },
      {
        key: 'retrieval',
        label: 'Hybrid Retrieval',
        durationMs: 300,
        data: { queryVariantCount: 3, hybridSearchEnabled: true, vectorHits: 12, keywordHits: 8, fusedCandidates: 10 },
      },
      {
        key: 'dedup',
        label: 'Deduplication',
        durationMs: 2,
        data: { enabled: true, before: 10, after: 8, removed: 2 },
      },
      {
        key: 'rerank',
        label: 'LLM Reranking',
        durationMs: 180,
        data: {
          candidatesIn: 8,
          topK: 5,
          baseTopK: 5,
          adaptiveTopKApplied: false,
          rescueTriggered: false,
          kept: [{ filename: 'cryptex.md', chunkIndex: 0 }],
          dropped: [{ filename: 'cryptex.md', chunkIndex: 3 }],
        },
      },
      {
        key: 'generation',
        label: 'Answer Generation',
        durationMs: 900,
        data: { chunksUsed: 1, answerLength: 210 },
      },
      {
        key: 'verification',
        label: 'Self-Verification',
        durationMs: 150,
        data: { passed: true, issue: null, wasRevised: false },
      },
    ],
    ...overrides,
  };
}

describe('PipelineInspectorTrigger', () => {
  it('renders a trigger button with the total duration', () => {
    render(<PipelineInspectorTrigger trace={makeTrace()} />);
    expect(screen.getByRole('button', { name: /inspect pipeline/i })).toBeInTheDocument();
    expect(screen.getByText(/1\.9s/)).toBeInTheDocument();
  });

  it('opens the dialog and shows every stage label on click', async () => {
    const user = userEvent.setup();
    render(<PipelineInspectorTrigger trace={makeTrace()} />);

    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));

    expect(screen.getByText('Pipeline Trace')).toBeInTheDocument();
    expect(screen.getByText('Query Rewrite')).toBeInTheDocument();
    expect(screen.getByText('Query Expansion')).toBeInTheDocument();
    expect(screen.getByText('Hybrid Retrieval')).toBeInTheDocument();
    expect(screen.getByText('Deduplication')).toBeInTheDocument();
    expect(screen.getByText('LLM Reranking')).toBeInTheDocument();
    expect(screen.getByText('Answer Generation')).toBeInTheDocument();
    expect(screen.getByText('Self-Verification')).toBeInTheDocument();
  });

  it('shows the rewritten query when the rewrite stage changed the question', async () => {
    const user = userEvent.setup();
    render(<PipelineInspectorTrigger trace={makeTrace()} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText('What is Cryptex?')).toBeInTheDocument();
  });

  it('shows a rescue notice when the reranker rejected everything but a rescue kicked in', async () => {
    const user = userEvent.setup();
    const trace = makeTrace();
    trace.stages = trace.stages.map((s) =>
      s.key === 'rerank' ? { ...s, data: { ...s.data, rescueTriggered: true } } : s
    );
    render(<PipelineInspectorTrigger trace={trace} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText(/rescued using the unranked top candidates/i)).toBeInTheDocument();
  });

  it('shows the no-info notice when nothing cleared the relevance bar', async () => {
    const user = userEvent.setup();
    const trace = makeTrace({
      noInfo: true,
      stages: [
        { key: 'rewrite', label: 'Query Rewrite', durationMs: 100, data: { enabled: true, changed: false } },
        { key: 'expansion', label: 'Query Expansion', durationMs: 90, data: { enabled: true, variants: [] } },
        {
          key: 'retrieval',
          label: 'Hybrid Retrieval',
          durationMs: 200,
          data: { queryVariantCount: 1, hybridSearchEnabled: true, vectorHits: 0, keywordHits: 0, fusedCandidates: 0 },
        },
        { key: 'dedup', label: 'Deduplication', durationMs: 0, data: { enabled: true, before: 0, after: 0, removed: 0 } },
      ],
    });
    render(<PipelineInspectorTrigger trace={trace} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText(/generation was skipped/i)).toBeInTheDocument();
    expect(screen.queryByText('Answer Generation')).not.toBeInTheDocument();
  });
});
