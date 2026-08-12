/**
 * Standalone test for traceBuilder.js - no API key needed.
 * Run with: npm run test:tracebuilder
 */
const { buildTrace } = require('../services/traceBuilder');

console.log('=== Trace Builder Test ===\n');

// Case 1: a normal successful run - all stages present, in order.
const normalRaw = {
  originalQuestion: 'what about the second one?',
  rewriteEnabled: true,
  searchQuery: 'What is the second security feature of Cryptex?',
  rewriteMs: 120,
  expansionEnabled: true,
  expandedQueries: ['Which security feature is listed second for Cryptex?', 'Cryptex second security capability'],
  expansionMs: 140,
  queryVariantCount: 3,
  hybridSearchEnabled: true,
  vectorHits: 14,
  keywordHits: 9,
  fusedCount: 12,
  retrievalMs: 310,
  candidatePoolRawCount: 12,
  dedupEnabled: true,
  candidatePoolCount: 9,
  dedupMs: 2,
  topK: 5,
  baseTopK: 5,
  rerankEnabled: true,
  rerankMs: 180,
  rescueTriggered: false,
  kept: [{ filename: 'cryptex.md', section: 'Security', chunkIndex: 2 }],
  dropped: [{ filename: 'cryptex.md', section: 'Overview', chunkIndex: 0 }],
  generationMs: 900,
  chunksUsedCount: 1,
  answerLength: 240,
  verificationEnabled: true,
  verificationMs: 150,
  verificationIssue: null,
  verificationPassed: true,
  wasRevised: false,
  totalMs: 1802,
};

const normalTrace = buildTrace(normalRaw);
const stageKeys = normalTrace.stages.map((s) => s.key);
console.log('Stage order:', stageKeys.join(' -> '));
console.assert(
  JSON.stringify(stageKeys) === JSON.stringify(['rewrite', 'expansion', 'retrieval', 'dedup', 'rerank', 'generation', 'verification']),
  'FAIL: unexpected stage order/set for a normal run'
);
console.assert(normalTrace.totalMs === 1802, 'FAIL: totalMs not passed through');
console.assert(normalTrace.noInfo === false, 'FAIL: noInfo should be false for a normal run');
console.log(stageKeys.length === 7 ? '✅ Normal run produces all 7 stages in the correct order' : '❌ FAILED');

const rewriteStage = normalTrace.stages.find((s) => s.key === 'rewrite');
console.assert(rewriteStage.data.changed === true, 'FAIL: rewrite stage should detect the query changed');
console.log(rewriteStage.data.changed ? '✅ Rewrite stage correctly flags the query as changed' : '❌ FAILED');

const rerankStage = normalTrace.stages.find((s) => s.key === 'rerank');
console.assert(rerankStage.label === 'LLM Reranking', 'FAIL: expected LLM Reranking label when rerankEnabled=true');
console.assert(rerankStage.data.adaptiveTopKApplied === false, 'FAIL: topK === baseTopK should mean adaptiveTopKApplied=false');
console.log('✅ Rerank stage labeled correctly and adaptive top-K flag accurate');

// Case 2: no history, rewrite disabled - query unchanged, no expansion.
const noRewriteRaw = {
  originalQuestion: 'What year was Cryptex founded?',
  rewriteEnabled: false,
  searchQuery: 'What year was Cryptex founded?',
  rewriteMs: 0,
  expansionEnabled: false,
  expandedQueries: [],
  expansionMs: 0,
  queryVariantCount: 1,
  hybridSearchEnabled: true,
  vectorHits: 5,
  keywordHits: 3,
  fusedCount: 5,
  retrievalMs: 200,
  candidatePoolRawCount: 5,
  dedupEnabled: true,
  candidatePoolCount: 5,
  dedupMs: 1,
  topK: 5,
  baseTopK: 5,
  rerankEnabled: true,
  rerankMs: 90,
  rescueTriggered: false,
  kept: [],
  dropped: [],
  generationMs: 500,
  chunksUsedCount: 3,
  answerLength: 80,
  verificationEnabled: false,
  totalMs: 800,
};
const noRewriteTrace = buildTrace(noRewriteRaw);
const noRewriteStage = noRewriteTrace.stages.find((s) => s.key === 'rewrite');
console.assert(noRewriteStage.data.changed === false, 'FAIL: rewrite disabled should never report changed=true');
console.assert(
  !noRewriteTrace.stages.some((s) => s.key === 'verification'),
  'FAIL: verification stage should be omitted entirely when disabled'
);
console.log('✅ Disabled rewrite/verification correctly reflected (unchanged flag, stage omitted)');

// Case 3: rescue path triggered - reranker rejected everything but a
// rescue kicked in using the unranked top-K.
const rescueRaw = { ...normalRaw, rescueTriggered: true, kept: normalRaw.kept.slice(0, 1) };
const rescueTrace = buildTrace(rescueRaw);
console.assert(rescueTrace.stages.find((s) => s.key === 'rerank').data.rescueTriggered === true, 'FAIL: rescueTriggered flag lost');
console.log('✅ Rescue-path flag correctly carried through to the rerank stage');

// Case 4: adaptive top-K actually widened topK for a broad question.
const broadRaw = { ...normalRaw, topK: 8, baseTopK: 5 };
const broadTrace = buildTrace(broadRaw);
console.assert(
  broadTrace.stages.find((s) => s.key === 'rerank').data.adaptiveTopKApplied === true,
  'FAIL: topK !== baseTopK should mean adaptiveTopKApplied=true'
);
console.log('✅ Adaptive top-K widening correctly detected (topK !== baseTopK)');

// Case 5: no_info short-circuit - only the first 4 stages should appear,
// and noInfo should be true (this is what the Inspector uses to explain
// why no answer was generated).
const noInfoRaw = {
  originalQuestion: 'What is the capital of a country not in any document?',
  rewriteEnabled: true,
  searchQuery: 'What is the capital of a country not in any document?',
  rewriteMs: 100,
  expansionEnabled: true,
  expandedQueries: ['Capital city of an unlisted country'],
  expansionMs: 120,
  queryVariantCount: 2,
  hybridSearchEnabled: true,
  vectorHits: 2,
  keywordHits: 0,
  fusedCount: 0,
  retrievalMs: 250,
  candidatePoolRawCount: 0,
  dedupEnabled: true,
  candidatePoolCount: 0,
  dedupMs: 0,
  noInfo: true,
  totalMs: 470,
};
const noInfoTrace = buildTrace(noInfoRaw);
console.assert(noInfoTrace.noInfo === true, 'FAIL: noInfo flag should be true');
console.assert(
  JSON.stringify(noInfoTrace.stages.map((s) => s.key)) === JSON.stringify(['rewrite', 'expansion', 'retrieval', 'dedup']),
  'FAIL: no_info trace should stop after the dedup stage'
);
console.log('✅ no_info short-circuit correctly stops the trace after dedup, no rerank/generation/verification stages');

// Case 6: missing/undefined fields should never throw - defensive defaults.
// (raw.noInfo is undefined/falsy here, so this does NOT short-circuit -
// it's a "normal run" shape with everything zeroed/undefined, distinct
// from Case 5's explicit noInfo:true short-circuit.)
const sparseTrace = buildTrace({});
console.assert(
  Array.isArray(sparseTrace.stages) && sparseTrace.stages.length === 6,
  `FAIL: sparse input should still produce 6 stages (no verification, since verificationEnabled is falsy) without throwing, got ${sparseTrace.stages.length}`
);
console.log('✅ Sparse/incomplete raw input handled without throwing (defensive defaults)');

console.log('\n✅ All trace builder tests passed.');

// ============================================================
// buildAgenticTrace - the agentic-mode counterpart to buildTrace above
// ============================================================
console.log('\n=== Agentic Trace Builder Test ===\n');
const { buildAgenticTrace } = require('../services/traceBuilder');

// Case A: a normal multi-step agentic run (a comparison question that
// triggered two search_documents calls).
const agenticNormalRaw = {
  planningMs: 640,
  skippedSearch: false,
  steps: [
    { tool: 'search_documents', query: 'Cryptex security features', chunksFound: 2, rescueTriggered: false, durationMs: 310 },
    { tool: 'search_documents', query: 'WS Inspector deployment process', chunksFound: 1, rescueTriggered: false, durationMs: 290 },
  ],
  dedupMs: 2,
  dedupEnabled: true,
  before: 3,
  after: 3,
  generationMs: 950,
  chunksUsedCount: 3,
  answerLength: 300,
  verificationEnabled: true,
  verificationMs: 140,
  verificationIssue: null,
  verificationPassed: true,
  wasRevised: false,
  totalMs: 1750,
};
const agenticNormalTrace = buildAgenticTrace(agenticNormalRaw);
console.assert(agenticNormalTrace.agentic === true, 'FAIL: agentic trace should be flagged agentic:true');
const agenticStageKeys = agenticNormalTrace.stages.map((s) => s.key);
console.assert(
  JSON.stringify(agenticStageKeys) === JSON.stringify(['planning', 'dedup', 'generation', 'verification']),
  `FAIL: unexpected agentic stage order, got ${agenticStageKeys.join(',')}`
);
const planningStage = agenticNormalTrace.stages.find((s) => s.key === 'planning');
console.assert(planningStage.data.totalSteps === 2, 'FAIL: totalSteps should reflect the number of tool-call steps taken');
console.assert(planningStage.data.skippedSearch === false, 'FAIL: skippedSearch should be false when searches happened');
console.assert(planningStage.data.steps.length === 2, 'FAIL: individual step details should be preserved');
console.log('✅ Multi-step agentic run produces planning -> dedup -> generation -> verification, with both steps captured');

const agenticDedupStage = agenticNormalTrace.stages.find((s) => s.key === 'dedup');
console.assert(agenticDedupStage.label === 'Merge & Deduplicate', 'FAIL: agentic dedup stage should use the merge-specific label');
console.log('✅ Agentic dedup stage uses the "Merge & Deduplicate" label, distinct from the fixed pipeline\'s "Deduplication"');

// Case B: skipped search (a greeting) - planning is the only meaningful
// signal, but generation/verification still run (with zero sources).
const skippedRaw = {
  planningMs: 180,
  skippedSearch: true,
  steps: [],
  dedupMs: 0,
  dedupEnabled: true,
  before: 0,
  after: 0,
  generationMs: 220,
  chunksUsedCount: 0,
  answerLength: 40,
  verificationEnabled: true,
  verificationMs: 90,
  verificationPassed: true,
  wasRevised: false,
  totalMs: 490,
};
const skippedTrace = buildAgenticTrace(skippedRaw);
console.assert(skippedTrace.stages.find((s) => s.key === 'planning').data.skippedSearch === true, 'FAIL: skippedSearch flag lost');
console.assert(skippedTrace.noInfo === false, 'FAIL: skipping search on purpose is NOT the same as noInfo - generation still ran');
console.log('✅ Skipped-search (small talk) case distinguished from noInfo - generation still proceeds with zero sources');

// Case C: genuine no_info - the planner searched but found nothing across
// every attempt. Should short-circuit after the planning stage, same
// pattern as the fixed pipeline's no_info short-circuit after dedup.
const agenticNoInfoRaw = {
  planningMs: 400,
  skippedSearch: false,
  steps: [{ tool: 'search_documents', query: 'unrelated topic', chunksFound: 0, rescueTriggered: false, durationMs: 380 }],
  noInfo: true,
  totalMs: 400,
};
const agenticNoInfoTrace = buildAgenticTrace(agenticNoInfoRaw);
console.assert(agenticNoInfoTrace.noInfo === true, 'FAIL: noInfo flag should be true');
console.assert(
  JSON.stringify(agenticNoInfoTrace.stages.map((s) => s.key)) === JSON.stringify(['planning']),
  'FAIL: agentic no_info trace should stop after the planning stage'
);
console.log('✅ Agentic no_info short-circuit stops after the planning stage (no dedup/generation/verification stages)');

// Case D: verification triggered a re-search on revision - the extra
// research fields should be reflected in the verification stage's data.
const researchRevisionRaw = { ...agenticNormalRaw, wasRevised: true, researchOnRevision: true, researchOnRevisionMs: 500, revisionGenerationMs: 700, additionalStepsOnRevision: [{ tool: 'search_documents', query: 'more specific query', chunksFound: 1, rescueTriggered: false, durationMs: 260 }] };
const researchRevisionTrace = buildAgenticTrace(researchRevisionRaw);
const verificationStage = researchRevisionTrace.stages.find((s) => s.key === 'verification');
console.assert(verificationStage.data.researchOnRevision === true, 'FAIL: researchOnRevision flag lost');
console.assert(verificationStage.data.additionalStepsOnRevision.length === 1, 'FAIL: additional research steps on revision should be preserved');
console.log('✅ Re-search-on-revision correctly reflected in the verification stage (flag + extra steps)');

// Case E: defensive defaults - sparse input shouldn't throw.
const sparseAgenticTrace = buildAgenticTrace({});
console.assert(Array.isArray(sparseAgenticTrace.stages) && sparseAgenticTrace.stages.length >= 1, 'FAIL: sparse agentic input should not throw');
console.log('✅ Sparse/incomplete agentic raw input handled without throwing');

console.log('\n✅ All agentic trace builder tests passed.');
