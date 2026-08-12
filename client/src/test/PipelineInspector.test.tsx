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

describe('PipelineInspectorTrigger - agentic mode', () => {
  function makeAgenticTrace(overrides: Partial<PipelineTrace> = {}): PipelineTrace {
    return {
      totalMs: 2100,
      noInfo: false,
      agentic: true,
      stages: [
        {
          key: 'planning',
          label: 'Agent Planning',
          durationMs: 640,
          data: {
            skippedSearch: false,
            totalSteps: 2,
            steps: [
              { tool: 'search_documents', query: 'Cryptex security features', chunksFound: 2, rescueTriggered: false, durationMs: 310 },
              { tool: 'search_documents', query: 'WS Inspector deployment', chunksFound: 1, rescueTriggered: false, durationMs: 290 },
            ],
          },
        },
        { key: 'dedup', label: 'Merge & Deduplicate', durationMs: 2, data: { enabled: true, before: 3, after: 3, removed: 0 } },
        { key: 'generation', label: 'Answer Generation', durationMs: 950, data: { chunksUsed: 3, answerLength: 300 } },
        { key: 'verification', label: 'Self-Verification', durationMs: 140, data: { passed: true, issue: null, wasRevised: false } },
      ],
      ...overrides,
    };
  }

  it('shows an agentic badge and the merge-dedup label distinct from the fixed pipeline', async () => {
    const user = userEvent.setup();
    render(<PipelineInspectorTrigger trace={makeAgenticTrace()} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText('agentic')).toBeInTheDocument();
    expect(screen.getByText('Agent Planning')).toBeInTheDocument();
    expect(screen.getByText('Merge & Deduplicate')).toBeInTheDocument();
  });

  it('lists every search step with its query and result count', async () => {
    const user = userEvent.setup();
    render(<PipelineInspectorTrigger trace={makeAgenticTrace()} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText('"Cryptex security features"')).toBeInTheDocument();
    expect(screen.getByText('"WS Inspector deployment"')).toBeInTheDocument();
    expect(screen.getByText('2 passage(s) found')).toBeInTheDocument();
  });

  it('shows a skipped-search notice instead of steps when the agent decided no search was needed', async () => {
    const user = userEvent.setup();
    const trace = makeAgenticTrace();
    trace.stages[0] = { key: 'planning', label: 'Agent Planning', durationMs: 180, data: { skippedSearch: true, totalSteps: 0, steps: [] } };
    render(<PipelineInspectorTrigger trace={trace} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText(/didn't need a document search/i)).toBeInTheDocument();
  });

  it('shows the no-info notice and stops after planning when every search came up empty', async () => {
    const user = userEvent.setup();
    const trace = makeAgenticTrace({
      noInfo: true,
      stages: [
        {
          key: 'planning',
          label: 'Agent Planning',
          durationMs: 400,
          data: { skippedSearch: false, totalSteps: 1, steps: [{ tool: 'search_documents', query: 'unrelated topic', chunksFound: 0, rescueTriggered: false, durationMs: 380 }] },
        },
      ],
    });
    render(<PipelineInspectorTrigger trace={trace} />);
    await user.click(screen.getByRole('button', { name: /inspect pipeline/i }));
    expect(screen.getByText(/generation was skipped/i)).toBeInTheDocument();
    expect(screen.getByText('nothing relevant found')).toBeInTheDocument();
    expect(screen.queryByText('Answer Generation')).not.toBeInTheDocument();
  });
});
