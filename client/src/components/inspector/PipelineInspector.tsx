import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Workflow,
  Wand2,
  GitBranch,
  Search,
  Layers,
  ListFilter,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  X,
  ArrowRight,
  LifeBuoy,
  Bot,
  ListTree,
  MessageCircle,
} from 'lucide-react';
import { useState } from 'react';
import type { PipelineTrace, TraceStage, TraceChunkRef, AgentStep } from '../../lib/types';

const STAGE_ICONS: Record<TraceStage['key'], React.ComponentType<{ size?: number }>> = {
  rewrite: Wand2,
  expansion: GitBranch,
  retrieval: Search,
  dedup: Layers,
  rerank: ListFilter,
  generation: Sparkles,
  verification: ShieldCheck,
  planning: Bot,
};

function formatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Finds a stage by key without throwing when it's absent - not every
 * stage appears in every trace (e.g. 'planning' is agentic-only). */
function findStage(trace: PipelineTrace, key: TraceStage['key']) {
  return trace.stages.find((s) => s.key === key);
}

/** A small top-of-modal scorecard - the handful of numbers someone
 * skimming the trace actually wants first, pulled from whichever stages
 * happen to have them (every field is optional - a fixed-pipeline trace
 * and an agentic one don't carry the same stages at all). Nothing here is
 * computed or estimated; it's the same data the stage list below shows,
 * just surfaced before it instead of after. */
function SummaryStrip({ trace }: { trace: PipelineTrace }) {
  const rerank = findStage(trace, 'rerank');
  const generation = findStage(trace, 'generation');
  const verification = findStage(trace, 'verification');
  const retrieval = findStage(trace, 'retrieval');

  const chips: { icon: React.ComponentType<{ size?: number }>; label: string; tone?: 'good' | 'warn' }[] = [];

  if (rerank?.data.candidatesIn !== undefined && generation?.data.chunksUsed !== undefined) {
    chips.push({ icon: ListFilter, label: `${generation.data.chunksUsed} of ${rerank.data.candidatesIn} candidates used` });
  }
  if (retrieval?.data.vectorHits !== undefined || retrieval?.data.keywordHits !== undefined) {
    const total = (retrieval?.data.vectorHits || 0) + (retrieval?.data.hybridSearchEnabled ? retrieval?.data.keywordHits || 0 : 0);
    chips.push({ icon: Search, label: `${total} raw hits retrieved` });
  }
  if (verification) {
    chips.push({
      icon: verification.data.passed ? ShieldCheck : ShieldAlert,
      label: verification.data.wasRevised ? 'Verified after revision' : verification.data.passed ? 'Verified' : 'Unsupported claim flagged',
      tone: verification.data.passed ? 'good' : 'warn',
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {chips.map(({ icon: Icon, label, tone }, i) => (
        <span
          key={i}
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={
            tone === 'warn'
              ? { background: 'color-mix(in srgb, var(--highlight) 12%, transparent)', color: 'var(--highlight)' }
              : tone === 'good'
                ? { background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }
                : { background: 'var(--surface)', color: 'var(--ink-muted)' }
          }
        >
          <Icon size={11} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** A single-row "waterfall" - each stage's share of total time as a
 * proportional, color-cycled segment, hover-titled with the exact
 * duration. The stage list below already shows each duration individually;
 * this exists purely to give the whole pipeline's shape at a glance before
 * reading line by line, the way a real request-tracing tool would. */
function DurationWaterfall({ trace }: { trace: PipelineTrace }) {
  if (trace.totalMs <= 0) return null;
  return (
    <div className="mb-5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface)' }}>
        {trace.stages.map((stage, i) => {
          const pct = Math.max(0.5, (stage.durationMs / trace.totalMs) * 100);
          return (
            <div
              key={stage.key}
              title={`${stage.label} - ${formatMs(stage.durationMs)}`}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${pct}%`,
                background: 'var(--accent)',
                opacity: 0.35 + (i / Math.max(1, trace.stages.length - 1)) * 0.5,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Small non-interactive chunk reference chip - used for the rerank stage's kept/dropped lists. */
function ChunkChip({ chunk, tone }: { chunk: TraceChunkRef; tone: 'kept' | 'dropped' }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px]"
      style={
        tone === 'kept'
          ? { background: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--accent)' }
          : { background: 'var(--surface)', color: 'var(--ink-muted)', textDecoration: 'line-through' }
      }
      title={chunk.section ? `${chunk.filename} - ${chunk.section}` : chunk.filename}
    >
      {chunk.filename}
      <span className="opacity-70">#{chunk.chunkIndex}</span>
    </span>
  );
}

function StageDetail({ stage }: { stage: TraceStage }) {
  const d = stage.data;

  if (stage.key === 'planning') {
    if (d.skippedSearch) {
      return (
        <p className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]" style={{ background: 'color-mix(in srgb, var(--accent) 8%, transparent)', color: 'var(--ink-muted)' }}>
          <MessageCircle size={11} className="shrink-0" />
          The agent decided this didn't need a document search (looked like a greeting or meta question).
        </p>
      );
    }
    if (!d.steps || d.steps.length === 0) {
      return <p className="text-xs text-ink-muted">No search steps recorded.</p>;
    }
    return (
      <ul className="flex flex-col gap-1.5 text-xs">
        {d.steps.map((step, i) => <PlanStepRow key={i} step={step} />)}
      </ul>
    );
  }

  if (stage.key === 'rewrite') {
    if (!d.enabled) return <p className="text-xs text-ink-muted">Disabled - the raw question is searched as-is.</p>;
    if (!d.changed) return <p className="text-xs text-ink-muted">No conversation history to rewrite from, or no change was needed.</p>;
    return (
      <div className="flex flex-col gap-1 text-xs">
        <p className="text-ink-muted">
          <span className="font-mono text-[10px] uppercase tracking-wide">original</span> · {d.original}
        </p>
        <p className="flex items-center gap-1.5 text-ink">
          <ArrowRight size={11} className="shrink-0 text-accent" />
          {d.rewritten}
        </p>
      </div>
    );
  }

  if (stage.key === 'expansion') {
    if (!d.enabled) return <p className="text-xs text-ink-muted">Disabled - only the original query was searched.</p>;
    if (!d.variants || d.variants.length === 0) return <p className="text-xs text-ink-muted">No variants generated - searched with the original query only.</p>;
    return (
      <ul className="flex flex-col gap-1 text-xs text-ink">
        {d.variants.map((v, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 font-mono text-[10px] text-ink-muted">{i + 1}</span>
            {v}
          </li>
        ))}
      </ul>
    );
  }

  if (stage.key === 'retrieval') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Stat label="Query variants searched" value={d.queryVariantCount} />
        <Stat label="Vector hits" value={d.vectorHits} />
        <Stat label="Keyword hits" value={d.hybridSearchEnabled ? d.keywordHits : 'disabled'} />
        <Stat label="Fused candidates" value={d.fusedCandidates} />
      </div>
    );
  }

  if (stage.key === 'dedup') {
    if (!d.enabled) return <p className="text-xs text-ink-muted">Disabled - no near-duplicate filtering applied.</p>;
    return (
      <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
        <Stat label="Before" value={d.before} />
        <Stat label="After" value={d.after} />
        <Stat label="Removed" value={d.removed} tone={d.removed && d.removed > 0 ? 'highlight' : undefined} />
      </div>
    );
  }

  if (stage.key === 'rerank') {
    return (
      <div className="flex flex-col gap-2 text-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <Stat label="Candidates in" value={d.candidatesIn} />
          <Stat label="Top-K" value={d.adaptiveTopKApplied ? `${d.topK} (widened from ${d.baseTopK})` : d.topK} />
        </div>
        {d.rescueTriggered && (
          <p className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]" style={{ background: 'color-mix(in srgb, var(--highlight) 10%, transparent)', color: 'var(--highlight)' }}>
            <LifeBuoy size={11} className="shrink-0" />
            Reranker rejected everything - rescued using the unranked top candidates instead.
          </p>
        )}
        {d.kept && d.kept.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-muted">used for the answer</p>
            <div className="flex flex-wrap gap-1">
              {d.kept.map((c, i) => <ChunkChip key={i} chunk={c} tone="kept" />)}
            </div>
          </div>
        )}
        {d.dropped && d.dropped.length > 0 && (
          <div>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-ink-muted">passed over</p>
            <div className="flex flex-wrap gap-1">
              {d.dropped.map((c, i) => <ChunkChip key={i} chunk={c} tone="dropped" />)}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (stage.key === 'generation') {
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Stat label="Source chunks used" value={d.chunksUsed} />
        <Stat label="Answer length" value={d.answerLength ? `${d.answerLength} chars` : undefined} />
      </div>
    );
  }

  if (stage.key === 'verification') {
    return (
      <div className="flex flex-col gap-1.5 text-xs">
        <p className="flex items-center gap-1.5" style={{ color: d.passed ? 'var(--accent)' : 'var(--highlight)' }}>
          {d.passed ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
          {d.passed ? 'Answer supported by its sources' : 'Unsupported claim detected'}
        </p>
        {d.issue && <p className="text-ink-muted">"{d.issue}"</p>}
        {d.wasRevised && (
          <p className="text-ink-muted">
            Revised in {formatMs(d.revisionGenerationMs || 0)} and re-checked.
          </p>
        )}
        {d.researchOnRevision && d.additionalStepsOnRevision && d.additionalStepsOnRevision.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
              <ListTree size={11} />
              searched again for the fix
            </p>
            <ul className="flex flex-col gap-1.5">
              {d.additionalStepsOnRevision.map((step, i) => <PlanStepRow key={i} step={step} />)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return null;
}

/** One tool-call step in the planning stage's step list, or the "searched again" list under a revision. */
function PlanStepRow({ step }: { step: AgentStep }) {
  if (step.tool === 'list_documents') {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md px-2 py-1" style={{ background: 'var(--surface)' }}>
        <span className="flex items-center gap-1.5 text-ink">
          <ListTree size={11} className="shrink-0 text-accent" />
          Listed available documents
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-muted">{formatMs(step.durationMs)}</span>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-0.5 rounded-md px-2 py-1" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-ink">
          <Search size={11} className="shrink-0 text-accent" />
          "{step.query}"
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-muted">{formatMs(step.durationMs)}</span>
      </div>
      <span className="pl-[17px] text-ink-muted">
        {step.chunksFound > 0 ? `${step.chunksFound} passage(s) found` : 'nothing relevant found'}
        {step.rescueTriggered && ' · rescued'}
      </span>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number | undefined; tone?: 'highlight' }) {
  if (value === undefined) return null;
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="text-sm" style={tone === 'highlight' ? { color: 'var(--highlight)' } : { color: 'var(--ink)' }}>
        {value}
      </p>
    </div>
  );
}

function StageRow({ stage, totalMs, isLast }: { stage: TraceStage; totalMs: number; isLast: boolean }) {
  const Icon = STAGE_ICONS[stage.key];
  const widthPct = totalMs > 0 ? Math.max(2, Math.min(100, (stage.durationMs / totalMs) * 100)) : 0;

  return (
    <div className="relative flex gap-3 pb-5">
      {!isLast && <div className="absolute left-[13px] top-7 bottom-0 w-px" style={{ background: 'var(--border-color)' }} />}
      <div
        className="relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          color: 'var(--accent)',
        }}
      >
        <Icon size={12} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink">{stage.label}</p>
          <span className="shrink-0 font-mono text-[11px] text-ink-muted">{formatMs(stage.durationMs)}</span>
        </div>
        <div className="mt-1 mb-2 h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface)' }}>
          <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: 'var(--accent)', opacity: 0.5 }} />
        </div>
        <StageDetail stage={stage} />
      </div>
    </div>
  );
}

export function PipelineInspectorTrigger({ trace }: { trace: PipelineTrace }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-xs text-ink-muted cursor-pointer hover:text-accent transition-colors"
        >
          {trace.agentic ? <Bot size={12} /> : <Workflow size={12} />}
          Inspect pipeline
          <span className="font-mono text-[10px] opacity-70">({formatMs(trace.totalMs)})</span>
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                // Blurred, not just dimmed - backdrop-blur reads as looking
                // "through frosted glass" at the still-legible chat behind
                // it, which feels considerably more deliberate than a flat
                // opacity fade over the same content. The tint itself is
                // lighter than a typical full-fade overlay (color-mix
                // against transparent, not the theme's opaque --overlay)
                // since the blur alone already does most of the work of
                // visually separating the modal from what's behind it.
                className="signal-theme fixed inset-0 z-[100] backdrop-blur-md"
                style={{ background: 'color-mix(in srgb, var(--overlay) 55%, transparent)' }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="signal-theme font-signal-body fixed left-1/2 top-1/2 z-[101] max-h-[85vh] w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl"
              >
                <div className="glass-panel rounded-2xl p-6">
                  <div className="mb-1 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Dialog.Title className="text-base font-semibold text-ink">Pipeline Trace</Dialog.Title>
                        {trace.agentic && (
                          <span
                            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                            style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                          >
                            <Bot size={9} />
                            agentic
                          </span>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-ink-muted">
                        {trace.stages.length} stages · {formatMs(trace.totalMs)} total
                      </p>
                    </div>
                    <Dialog.Close asChild>
                      <button type="button" className="cursor-pointer text-ink-muted hover:text-ink" aria-label="Close">
                        <X size={18} />
                      </button>
                    </Dialog.Close>
                  </div>

                  <div className="my-4 h-px w-full" style={{ background: 'var(--border-color)' }} />

                  <SummaryStrip trace={trace} />
                  <DurationWaterfall trace={trace} />

                  {trace.noInfo && (
                    <p
                      className="mb-4 rounded-md px-2.5 py-1.5 text-[11px]"
                      style={{ background: 'color-mix(in srgb, var(--highlight) 10%, transparent)', color: 'var(--highlight)' }}
                    >
                      No chunk cleared the relevance bar - generation was skipped and the "not enough information" answer was returned.
                    </p>
                  )}

                  <div>
                    {trace.stages.map((stage, i) => (
                      <StageRow key={stage.key} stage={stage} totalMs={trace.totalMs} isLast={i === trace.stages.length - 1} />
                    ))}
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
