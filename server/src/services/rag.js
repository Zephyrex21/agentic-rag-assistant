const { embedOne } = require('./embeddings');
const { queryVectors } = require('./pinecone');
const { keywordSearch } = require('./keywordSearch');
const { reciprocalRankFusion, normalizeRrfScore } = require('./rrf');
const { rewriteQuery } = require('./queryRewriter');
const { expandQuery } = require('./queryExpansion');
const { dedupeChunks } = require('./dedup');
const { rerank } = require('./reranker');
const { verifyAnswer } = require('./selfVerification');
const { generateAnswerStream } = require('./llm');
const { buildTrace, buildAgenticTrace } = require('./traceBuilder');

const TOP_K = parseInt(process.env.RETRIEVAL_TOP_K || '5', 10);
const CANDIDATE_POOL = parseInt(process.env.RETRIEVAL_CANDIDATE_POOL || '15', 10);
const MIN_RELEVANCE_SCORE = parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.35');
// Lower and deliberately distinct from MIN_RELEVANCE_SCORE above - this only
// gates the rerank-rejected-everything rescue path (see runRetrieval), not
// the primary retrieval decision. Kept lenient on purpose: the failure mode
// being guarded against is a false "I don't know" from an overly strict
// reranker judgment on a broad question, not weak/irrelevant matches.
const RERANK_RESCUE_THRESHOLD = parseFloat(process.env.RERANK_RESCUE_THRESHOLD || '0.15');
const DEDUP_SIMILARITY_THRESHOLD = parseFloat(process.env.DEDUP_SIMILARITY_THRESHOLD || '0.82');
// How many extra chunks a "broad" question (summarize, compare, overview,
// etc.) gets on top of RETRIEVAL_TOP_K - see computeTopK below.
const ADAPTIVE_TOPK_BONUS = parseInt(process.env.ADAPTIVE_TOPK_BONUS || '3', 10);

// Every stage of the pipeline is independently toggleable, so you can
// compare quality with/without each one, or turn off a stage if latency or
// free-tier quota ever gets tight - none of these require touching code.
const ENABLE_QUERY_REWRITE = process.env.ENABLE_QUERY_REWRITE !== 'false';
const ENABLE_QUERY_EXPANSION = process.env.ENABLE_QUERY_EXPANSION !== 'false';
const ENABLE_HYBRID_SEARCH = process.env.ENABLE_HYBRID_SEARCH !== 'false';
const ENABLE_RERANKING = process.env.ENABLE_RERANKING !== 'false';
const ENABLE_DEDUPLICATION = process.env.ENABLE_DEDUPLICATION !== 'false';
const ENABLE_ADAPTIVE_TOPK = process.env.ENABLE_ADAPTIVE_TOPK !== 'false';
const ENABLE_SELF_VERIFICATION = process.env.ENABLE_SELF_VERIFICATION !== 'false';
// Collecting the raw timing/counts below is cheap (just Date.now() calls and
// array lengths already available in scope) so it always happens - this
// toggle only controls whether the formatted trace is actually attached to
// the response/persisted, for people who'd rather not pay the (small) extra
// JSON payload size or DB storage.
const ENABLE_PIPELINE_TRACE = process.env.ENABLE_PIPELINE_TRACE !== 'false';
// Replaces the fixed rewrite->search->rerank sequence with a tool-calling
// planner (see agenticRag.js) that decides FOR ITSELF whether a question
// needs searching at all, and how many times, before generation runs - see
// the module doc comment on retrieveAndAnswerStream below for the full
// contract and fallback behavior.
const ENABLE_AGENTIC_MODE = process.env.ENABLE_AGENTIC_MODE !== 'false';

// Heuristic, not an LLM call on purpose - this only needs to catch the
// broad-question SHAPE (summaries, overviews, comparisons, "everything/all"
// asks), not truly understand the question, and a regex costs zero extra
// latency/tokens versus asking a model to classify it. Mirrors the same
// "broad question" concept the rerank prompt already reasons about in
// reranker.js - this just also widens how many chunks survive to get there.
const BROAD_QUESTION_RE =
  /\b(summarize|summarise|overview|everything|all of|entire|compare|comparison|difference between|list all|each|every|explain (the )?(whole|full)|what does .* cover|tell me about|what is this .*(about|for)|what('?s| is) (this|the) (document|file|readme|repo|project|repository) about)\b/i;

/**
 * Widens TOP_K for questions that read as broad/synthesis-style rather than
 * narrow/factual - a "summarize this document" question genuinely needs
 * more source chunks in context than "what year was X founded", and a
 * fixed TOP_K forces a compromise between the two. Disabled entirely
 * (always returns TOP_K) if ENABLE_ADAPTIVE_TOPK=false.
 */
function computeTopK(question) {
  if (!ENABLE_ADAPTIVE_TOPK) return TOP_K;
  return BROAD_QUESTION_RE.test(question || '') ? TOP_K + ADAPTIVE_TOPK_BONUS : TOP_K;
}

const NO_INFO_ANSWER =
  "I don't have enough relevant information in the uploaded documents to answer that. Try rephrasing, or upload a document that covers this topic.";

const EXCERPT_LENGTH = 200;

function extractCitedSourceNumbers(answerText) {
  const cited = new Set();
  const regex = /\(Source\s+(\d+)\)/gi;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(answerText)) !== null) {
    cited.add(parseInt(match[1], 10));
  }
  return cited;
}

/**
 * Runs vector search (always) and keyword search (if hybrid enabled) for a
 * SINGLE query string, normalizing both result shapes to the same fields.
 * Split out from gatherCandidates so multi-query retrieval can fan this out
 * across several query variants in parallel without duplicating the
 * metadata-normalization logic per variant. Also reports raw hit counts
 * (before fusion/dedup) purely for the pipeline trace.
 */
async function searchOneQuery(queryText, filter, documentIds) {
  const vectorPromise = embedOne(queryText, 'RETRIEVAL_QUERY').then((vector) =>
    queryVectors(vector, CANDIDATE_POOL, filter)
  );
  const keywordPromise = ENABLE_HYBRID_SEARCH
    ? keywordSearch(queryText, CANDIDATE_POOL, documentIds)
    : Promise.resolve([]);

  const [vectorMatches, keywordMatches] = await Promise.all([vectorPromise, keywordPromise]);

  const vectorList = vectorMatches.map((m) => ({ id: m.id }));
  const keywordList = keywordMatches.map((m) => ({ id: m.id }));

  const entries = [];
  for (const m of vectorMatches) {
    entries.push([
      m.id,
      {
        id: m.id,
        documentId: m.metadata.documentId,
        filename: m.metadata.filename,
        chunkIndex: m.metadata.chunkIndex,
        section: m.metadata.section,
        text: m.metadata.text,
      },
    ]);
  }
  for (const m of keywordMatches) {
    entries.push([
      m.id,
      { id: m.id, documentId: m.documentId, filename: m.filename, chunkIndex: m.chunkIndex, section: m.section, text: m.text },
    ]);
  }

  const lists = ENABLE_HYBRID_SEARCH ? [vectorList, keywordList] : [vectorList];
  return { lists, entries, vectorHitCount: vectorMatches.length, keywordHitCount: keywordMatches.length };
}

/**
 * Runs hybrid search for EVERY query variant (the original/rewritten query
 * plus any multi-query expansions) in parallel, then merges everything into
 * one flat set of ranked lists (for RRF) and one lookup map (to recover
 * full chunk data after fusion, since RRF itself only deals with IDs +
 * scores). A chunk surfaced by more than one query variant naturally scores
 * higher after fusion, the same way a chunk matched by both vector and
 * keyword search already did before multi-query existed - this is just
 * that same mechanism extended across more lists.
 *
 * @param {string[]} queries - one or more query strings to search with
 * @param {string[]} [documentIds] - optional scope filter
 */
async function gatherCandidates(queries, documentIds) {
  const filter = Array.isArray(documentIds) && documentIds.length > 0
    ? { documentId: { $in: documentIds } }
    : undefined;

  const perQueryResults = await Promise.all(queries.map((q) => searchOneQuery(q, filter, documentIds)));

  const lookup = new Map();
  const listsUsed = [];
  let vectorHits = 0;
  let keywordHits = 0;
  for (const { lists, entries, vectorHitCount, keywordHitCount } of perQueryResults) {
    for (const [id, value] of entries) {
      if (!lookup.has(id)) lookup.set(id, value);
    }
    listsUsed.push(...lists);
    vectorHits += vectorHitCount;
    keywordHits += keywordHitCount;
  }

  return { listsUsed, lookup, vectorHits, keywordHits };
}

/** Lightweight chunk reference for the trace - never the full text, just enough to identify it in the Inspector UI. */
function toChunkRef(c) {
  return { filename: c.filename, section: c.section && c.section !== 'N/A' ? c.section : undefined, chunkIndex: c.chunkIndex };
}

/**
 * The shared retrieval ENGINE: given a single already-standalone search
 * query, runs expand -> gather (hybrid search) -> fuse -> dedupe -> rerank,
 * and returns the resulting chunks. This is the core both retrieval modes
 * are built on:
 *   - the fixed pipeline (retrieveChunks below) calls it once, after its
 *     own query-rewrite step produces a standalone query
 *   - the agentic planner (agenticRag.js) calls it once per search_documents
 *     tool call it decides to make, with whatever query the model formulated
 *
 * Every chunk returned carries a `relevanceScore` (0-1, already normalized)
 * so callers that merge chunks from MULTIPLE calls to this function (the
 * agentic path, accumulating across several tool calls) don't need to
 * separately track which call's `listsUsed.length` a given chunk's raw
 * rrfScore should be normalized against - see buildSources below.
 *
 * Returns `{ chunks: null, ... }` if nothing cleared the relevance bar -
 * null (not an empty array) specifically means "this query came back
 * empty", distinct from an empty array which elsewhere means "no query was
 * even attempted" (see agenticRag.js's skipped-search path).
 *
 * @param {string} searchQuery
 * @param {string[]} [documentIds]
 */
async function runRetrieval(searchQuery, documentIds) {
  const traceRaw = {};

  // Multi-query retrieval: search with the original query AND a few
  // alternate phrasings in parallel, so wording that doesn't match the
  // document's exact vocabulary still has other angles to land on. All
  // variants' results get fused together by RRF below - a chunk multiple
  // variants agree on naturally outranks one only a single phrasing found.
  let t = Date.now();
  const expandedQueries = ENABLE_QUERY_EXPANSION ? await expandQuery(searchQuery) : [];
  traceRaw.expansionMs = Date.now() - t;
  traceRaw.expandedQueries = expandedQueries;
  const queries = [searchQuery, ...expandedQueries];
  traceRaw.queryVariantCount = queries.length;

  t = Date.now();
  const { listsUsed, lookup, vectorHits, keywordHits } = await gatherCandidates(queries, documentIds);
  const fused = reciprocalRankFusion(listsUsed);
  traceRaw.retrievalMs = Date.now() - t;
  traceRaw.hybridSearchEnabled = ENABLE_HYBRID_SEARCH;
  traceRaw.vectorHits = vectorHits;
  traceRaw.keywordHits = keywordHits;
  traceRaw.fusedCount = fused.length;

  if (fused.length === 0) {
    traceRaw.candidatePoolRawCount = 0;
    traceRaw.candidatePoolCount = 0;
    traceRaw.dedupEnabled = ENABLE_DEDUPLICATION;
    traceRaw.dedupMs = 0;
    traceRaw.noInfo = true;
    return { chunks: null, listsUsed, traceRaw };
  }

  const fusedPool = fused
    .slice(0, CANDIDATE_POOL)
    .map((f) => ({ ...lookup.get(f.id), rrfScore: f.rrfScore }))
    .filter((c) => c.id);
  traceRaw.candidatePoolRawCount = fusedPool.length;

  // Drop near-duplicate passages before they eat a slot in the reranker's
  // limited candidate budget - more likely to happen now that multi-query
  // retrieval searches the same corpus from several angles at once.
  t = Date.now();
  const candidatePool = ENABLE_DEDUPLICATION ? dedupeChunks(fusedPool, DEDUP_SIMILARITY_THRESHOLD) : fusedPool;
  traceRaw.dedupMs = Date.now() - t;
  traceRaw.dedupEnabled = ENABLE_DEDUPLICATION;
  traceRaw.candidatePoolCount = candidatePool.length;

  const topK = computeTopK(searchQuery);
  traceRaw.topK = topK;
  traceRaw.baseTopK = TOP_K;
  traceRaw.rerankEnabled = ENABLE_RERANKING;

  let finalChunks;
  let rescueTriggered = false;

  t = Date.now();
  if (ENABLE_RERANKING) {
    const rerankKept = await rerank(searchQuery, candidatePool, topK);
    if (rerankKept.length === 0) {
      // The reranker rejected everything. This can be a genuinely correct
      // call (nothing relevant exists) - but it can also be an overly
      // strict judgment, especially on broad "what is this about"-style
      // questions where no single passage "answers" the question even
      // though the document clearly has relevant content. Rather than
      // trust that single judgment absolutely, check whether retrieval
      // itself found a reasonably strong match before giving up - if so,
      // rescue with the unranked top-K instead of a false "I don't know."
      const topNormalized = normalizeRrfScore(candidatePool[0].rrfScore, listsUsed.length);
      if (topNormalized >= RERANK_RESCUE_THRESHOLD) {
        finalChunks = candidatePool.slice(0, topK);
        rescueTriggered = true;
      } else {
        traceRaw.rerankMs = Date.now() - t;
        traceRaw.rescueTriggered = false;
        traceRaw.kept = [];
        traceRaw.dropped = candidatePool.map(toChunkRef);
        traceRaw.noInfo = true;
        return { chunks: null, listsUsed, traceRaw };
      }
    } else {
      finalChunks = rerankKept;
    }
  } else {
    const topNormalized = normalizeRrfScore(candidatePool[0].rrfScore, listsUsed.length);
    if (topNormalized < MIN_RELEVANCE_SCORE) {
      traceRaw.rerankMs = Date.now() - t;
      traceRaw.rescueTriggered = false;
      traceRaw.kept = [];
      traceRaw.dropped = candidatePool.map(toChunkRef);
      traceRaw.noInfo = true;
      return { chunks: null, listsUsed, traceRaw };
    }
    finalChunks = candidatePool.slice(0, topK);
  }
  traceRaw.rerankMs = Date.now() - t;
  traceRaw.rescueTriggered = rescueTriggered;

  const keptIds = new Set(finalChunks.map((c) => c.id));
  traceRaw.kept = finalChunks.map(toChunkRef);
  traceRaw.dropped = candidatePool.filter((c) => !keptIds.has(c.id)).map(toChunkRef);

  // Normalize each chunk's relevance score NOW, against THIS call's own
  // listsUsed.length - callers merging chunks from multiple runRetrieval
  // calls (agenticRag.js) can then treat relevanceScore as directly
  // comparable across calls without re-deriving it later.
  const scoredChunks = finalChunks.map((c) => ({ ...c, relevanceScore: normalizeRrfScore(c.rrfScore, listsUsed.length) }));

  return { chunks: scoredChunks, listsUsed, traceRaw };
}

/**
 * Fixed-pipeline retrieval: rewrite the question into a standalone query
 * (using conversation history), then run it through runRetrieval once.
 * This is the deterministic, always-exactly-one-search path used when
 * ENABLE_AGENTIC_MODE is off, or as the fallback if agentic planning fails
 * (see retrieveAndAnswerStream).
 */
async function retrieveChunks(question, { documentIds, history = [] } = {}) {
  let t = Date.now();
  const searchQuery = ENABLE_QUERY_REWRITE ? await rewriteQuery(question, history) : question;
  const rewriteMs = Date.now() - t;

  const { chunks, listsUsed, traceRaw: retrievalTraceRaw } = await runRetrieval(searchQuery, documentIds);

  const traceRaw = {
    mode: 'fixed',
    originalQuestion: question,
    rewriteEnabled: ENABLE_QUERY_REWRITE,
    searchQuery,
    rewriteMs,
    ...retrievalTraceRaw,
  };

  return { chunks, searchQuery, listsUsed, traceRaw };
}

function buildSources(finalChunks, listsUsed, citedNumbers) {
  return finalChunks.map((c, i) => {
    const sourceNumber = i + 1;
    // Prefer a score already normalized by runRetrieval - required for
    // chunks accumulated across multiple search calls (agentic mode), and
    // just as correct for the single-call fixed pipeline (same formula,
    // computed one call earlier - see runRetrieval's comment on this field).
    const displayScore = c.relevanceScore !== undefined
      ? c.relevanceScore
      : c.rrfScore !== undefined
        ? normalizeRrfScore(c.rrfScore, listsUsed.length)
        : 0;
    return {
      sourceNumber,
      cited: citedNumbers.has(sourceNumber),
      documentId: c.documentId,
      filename: c.filename,
      chunkIndex: c.chunkIndex,
      section: c.section && c.section !== 'N/A' ? c.section : undefined,
      excerpt: c.text.length > EXCERPT_LENGTH ? `${c.text.slice(0, EXCERPT_LENGTH)}...` : c.text,
      fullText: c.text,
      relevanceScore: Math.round(displayScore * 1000) / 1000,
    };
  });
}

/**
 * Streaming retrieve-then-answer pipeline. Retrieval itself is NOT
 * streamed - fixed-pipeline retrieval is one rewrite + one search, fast
 * enough that streaming it wouldn't meaningfully help; agentic retrieval
 * (below) involves a few extra planning calls but is still short relative
 * to generation. Only the generation step streams. Yields events for a
 * route handler to forward as SSE:
 *   { type: 'sources', sources }  - as soon as retrieval completes (cited flags not yet known)
 *   { type: 'chunk', text }       - repeated, as the answer streams in (fired again
 *                                    for a revision pass, if one happens)
 *   { type: 'revising', issue }   - self-verification found a problem; a corrected
 *                                    answer is about to stream in, replacing this one
 *   { type: 'done', answer, sources, verified, wasRevised, trace } - final state
 *   { type: 'no_info', trace }    - nothing relevant found, no generation call made
 *
 * RETRIEVAL MODE: when ENABLE_AGENTIC_MODE is on, a tool-calling planner
 * (agenticRag.js) decides for itself whether the question needs searching
 * at all, and how many times, instead of always running exactly one
 * rewrite-then-search pass. If planning itself throws (a tool-calling API
 * error, for instance) BEFORE any event has been yielded, this falls back
 * to the fixed pipeline for that single request rather than failing it -
 * once past the first yielded event a fallback can't happen cleanly (the
 * client would see a confusing partial-then-restarted response), the same
 * constraint documented in llm.js's streaming fallback.
 *
 * SELF-VERIFICATION: runs after a first answer streams in - one cheap
 * batched call checks whether the answer is actually supported by its
 * sources. If not, ONE revision pass runs with the specific critique fed
 * back into the prompt. In agentic mode, that critique also drives a small
 * follow-up search (capped at 2 planner steps) for better source material
 * before regenerating - not just a reworded retry over the same chunks -
 * gated by ENABLE_AGENTIC_RESEARCH_ON_REVISION. Capped at a single revision
 * regardless of outcome either way - this is meant to catch genuine
 * mistakes, not loop indefinitely chasing a perfect score.
 *
 * `trace` (present when ENABLE_PIPELINE_TRACE is on) is a stage-by-stage
 * record of what the pipeline actually did for this query, built from data
 * already gathered during the run - producing it costs no extra API calls.
 * See traceBuilder.js for the fixed-pipeline shape and agenticRag.js /
 * traceBuilder.js's buildAgenticTrace for the agentic shape.
 */
async function* retrieveAndAnswerStream(question, options = {}) {
  const streamStart = Date.now();
  const { documentIds, history = [] } = options;

  let retrieval = null;
  if (ENABLE_AGENTIC_MODE) {
    try {
      // Lazy require avoids a require cycle: agenticRag.js needs rag.js's
      // runRetrieval/buildSources/NO_INFO_ANSWER, and this is the only
      // place rag.js needs anything back from agenticRag.js.
      const { runAgenticRetrieval } = require('./agenticRag');
      retrieval = await runAgenticRetrieval(question, documentIds, history);
    } catch (err) {
      console.warn(`[rag] agentic planning failed (${err.message}), falling back to the fixed pipeline for this query.`);
      retrieval = null;
    }
  }
  if (!retrieval) {
    retrieval = await retrieveChunks(question, { documentIds, history });
  }

  const { chunks, listsUsed, traceRaw } = retrieval;

  if (!chunks) {
    traceRaw.totalMs = Date.now() - streamStart;
    const trace = ENABLE_PIPELINE_TRACE
      ? traceRaw.mode === 'agentic' ? buildAgenticTrace(traceRaw) : buildTrace(traceRaw)
      : null;
    yield { type: 'no_info', answer: NO_INFO_ANSWER, trace };
    return;
  }

  const preliminarySources = buildSources(chunks, listsUsed, new Set());
  yield { type: 'sources', sources: preliminarySources };

  let workingChunks = chunks;
  let fullAnswer = '';
  let t = Date.now();
  for await (const textChunk of generateAnswerStream(question, workingChunks, history)) {
    fullAnswer += textChunk;
    yield { type: 'chunk', text: textChunk };
  }
  traceRaw.generationMs = Date.now() - t;
  traceRaw.chunksUsedCount = workingChunks.length;
  traceRaw.answerLength = fullAnswer.length;

  let citedNumbers = extractCitedSourceNumbers(fullAnswer);
  let finalSources = buildSources(workingChunks, listsUsed, citedNumbers);
  let verified = true;
  let wasRevised = false;
  traceRaw.verificationEnabled = ENABLE_SELF_VERIFICATION;

  if (ENABLE_SELF_VERIFICATION) {
    t = Date.now();
    const check = await verifyAnswer(question, fullAnswer, finalSources);
    traceRaw.verificationMs = Date.now() - t;
    traceRaw.verificationIssue = check.issue;

    if (!check.passed) {
      yield { type: 'revising', issue: check.issue };

      // Agentic mode gets one more chance to go find better source
      // material for the specific thing verification flagged, instead of
      // only rewording the same chunks - a small, capped follow-up search
      // rather than a full re-plan.
      const ENABLE_AGENTIC_RESEARCH_ON_REVISION = process.env.ENABLE_AGENTIC_RESEARCH_ON_REVISION !== 'false';
      if (ENABLE_AGENTIC_MODE && ENABLE_AGENTIC_RESEARCH_ON_REVISION && traceRaw.mode === 'agentic') {
        try {
          const { runAgenticRetrieval } = require('./agenticRag');
          const researchStart = Date.now();
          const research = await runAgenticRetrieval(
            `The previous answer to "${question}" had this problem: ${check.issue}. Search for information that would fix it.`,
            documentIds,
            history,
            { maxSteps: 2 }
          );
          traceRaw.researchOnRevisionMs = Date.now() - researchStart;
          traceRaw.researchOnRevision = true;
          traceRaw.additionalStepsOnRevision = research.traceRaw?.steps || [];
          if (research.chunks && research.chunks.length > 0) {
            const seenIds = new Set(workingChunks.map((c) => c.id));
            const merged = [...workingChunks, ...research.chunks.filter((c) => !seenIds.has(c.id))];
            workingChunks = ENABLE_DEDUPLICATION ? dedupeChunks(merged, DEDUP_SIMILARITY_THRESHOLD) : merged;
          }
        } catch (err) {
          console.warn(`[rag] re-search on revision failed (${err.message}), revising with the existing chunks only.`);
        }
      }

      let revisedAnswer = '';
      const revision = { previousAnswer: fullAnswer, issues: check.issue };
      t = Date.now();
      for await (const textChunk of generateAnswerStream(question, workingChunks, history, revision)) {
        revisedAnswer += textChunk;
        yield { type: 'chunk', text: textChunk };
      }
      traceRaw.revisionGenerationMs = Date.now() - t;
      traceRaw.chunksUsedCount = workingChunks.length;

      fullAnswer = revisedAnswer;
      citedNumbers = extractCitedSourceNumbers(fullAnswer);
      finalSources = buildSources(workingChunks, listsUsed, citedNumbers);
      wasRevised = true;

      // One more check on the revised answer, purely for the `verified`
      // flag shown in the UI - does NOT trigger a second revision loop.
      t = Date.now();
      const secondCheck = await verifyAnswer(question, fullAnswer, finalSources);
      traceRaw.secondVerificationMs = Date.now() - t;
      verified = secondCheck.passed;
    }
    traceRaw.verificationPassed = verified;
    traceRaw.wasRevised = wasRevised;
  }

  traceRaw.totalMs = Date.now() - streamStart;
  const trace = ENABLE_PIPELINE_TRACE
    ? traceRaw.mode === 'agentic' ? buildAgenticTrace(traceRaw) : buildTrace(traceRaw)
    : null;

  yield { type: 'done', answer: fullAnswer, sources: finalSources, verified, wasRevised, trace };
}

module.exports = {
  retrieveAndAnswerStream,
  NO_INFO_ANSWER,
  extractCitedSourceNumbers,
  computeTopK,
  BROAD_QUESTION_RE,
  runRetrieval,
  buildSources,
  toChunkRef,
};
