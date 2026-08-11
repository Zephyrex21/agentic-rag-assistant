/**
 * Formats the raw ingredients collected during retrieveAndAnswerStream into
 * an ordered list of pipeline stages a frontend "Inspector" panel can
 * render as a timeline - the same shape every stage, so the UI doesn't
 * need special-casing beyond reading each stage's `key`.
 *
 * Deliberately pure and separated from rag.js's orchestration, the same
 * way buildRerankPrompt/parseRerankResponse are split from the API call in
 * reranker.js - no network calls in here, so this is fully unit-testable
 * (test-tracebuilder.js) without touching any live service.
 *
 * @param {object} raw - see rag.js for exactly what's collected at each step
 * @returns {{stages: Array<{key: string, label: string, durationMs: number, data: object}>, totalMs: number, noInfo: boolean}}
 */
function buildTrace(raw) {
  const stages = [];

  stages.push({
    key: 'rewrite',
    label: 'Query Rewrite',
    durationMs: raw.rewriteMs || 0,
    data: {
      enabled: raw.rewriteEnabled,
      original: raw.originalQuestion,
      rewritten: raw.searchQuery,
      changed: raw.rewriteEnabled && raw.searchQuery !== raw.originalQuestion,
    },
  });

  stages.push({
    key: 'expansion',
    label: 'Query Expansion',
    durationMs: raw.expansionMs || 0,
    data: {
      enabled: raw.expansionEnabled,
      variants: raw.expandedQueries || [],
    },
  });

  stages.push({
    key: 'retrieval',
    label: 'Hybrid Retrieval',
    durationMs: raw.retrievalMs || 0,
    data: {
      queryVariantCount: raw.queryVariantCount,
      hybridSearchEnabled: raw.hybridSearchEnabled,
      vectorHits: raw.vectorHits,
      keywordHits: raw.keywordHits,
      fusedCandidates: raw.fusedCount,
      candidatesConsidered: raw.candidatePoolRawCount,
    },
  });

  stages.push({
    key: 'dedup',
    label: 'Deduplication',
    durationMs: raw.dedupMs || 0,
    data: {
      enabled: raw.dedupEnabled,
      before: raw.candidatePoolRawCount,
      after: raw.candidatePoolCount,
      removed: Math.max(0, (raw.candidatePoolRawCount || 0) - (raw.candidatePoolCount || 0)),
    },
  });

  if (raw.noInfo) {
    return { stages, totalMs: raw.totalMs || 0, noInfo: true };
  }

  stages.push({
    key: 'rerank',
    label: raw.rerankEnabled ? 'LLM Reranking' : 'Score Threshold',
    durationMs: raw.rerankMs || 0,
    data: {
      enabled: raw.rerankEnabled,
      candidatesIn: raw.candidatePoolCount,
      topK: raw.topK,
      baseTopK: raw.baseTopK,
      adaptiveTopKApplied: raw.topK !== raw.baseTopK,
      kept: raw.kept || [],
      dropped: raw.dropped || [],
      rescueTriggered: !!raw.rescueTriggered,
    },
  });

  stages.push({
    key: 'generation',
    label: 'Answer Generation',
    durationMs: raw.generationMs || 0,
    data: {
      chunksUsed: raw.chunksUsedCount,
      answerLength: raw.answerLength,
    },
  });

  if (raw.verificationEnabled) {
    stages.push({
      key: 'verification',
      label: 'Self-Verification',
      durationMs: (raw.verificationMs || 0) + (raw.revisionGenerationMs || 0) + (raw.secondVerificationMs || 0),
      data: {
        passed: raw.verificationPassed,
        issue: raw.verificationIssue,
        wasRevised: raw.wasRevised,
        revisionGenerationMs: raw.revisionGenerationMs || 0,
      },
    });
  }

  return { stages, totalMs: raw.totalMs || 0, noInfo: false };
}

module.exports = { buildTrace };
