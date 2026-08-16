const { embedOne } = require('./embeddings');
const { queryVectors } = require('./pinecone');
const { keywordSearch } = require('./keywordSearch');
const { reciprocalRankFusion, normalizeRrfScore } = require('./rrf');
const { rewriteQuery } = require('./queryRewriter');
const { expandQuery } = require('./queryExpansion');
const { dedupeChunks } = require('./dedup');
const { rerank } = require('./reranker');
const { verifyAnswer } = require('./selfVerification');
const { generateAnswerStream, generateAnswer } = require('./llm');
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

// Matches a whole citation group - a single "(Source 1)" OR a
// comma-separated group like "(Source 1, Source 3)", which the generation
// prompt explicitly asks the model to use when a claim draws on more than
// one source (see llm.js's rule 3). A single-number-only regex would miss
// grouped citations entirely, undercounting which sources were actually
// cited.
function extractCitedSourceNumbers(answerText) {
  const cited = new Set();
  const groupRegex = /\(Source\s+\d+(?:\s*,\s*Source\s+\d+)*\)/gi;
  let groupMatch;
  // eslint-disable-next-line no-cond-assign
  while ((groupMatch = groupRegex.exec(answerText)) !== null) {
    const numbers = groupMatch[0].match(/\d+/g) || [];
    for (const n of numbers) cited.add(parseInt(n, 10));
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
 *   { type: 'chunk', text }       - repeated, as the FIRST answer streams in
 *   { type: 'done', answer, sources, verified, wasRevised, trace }
 *       - the first answer is complete and FINAL as far as the person reading
 *         it is concerned - a route handler should treat this as the point to
 *         persist/display it. `verified` is `null` here specifically when
 *         self-verification is enabled but hasn't run yet - see below.
 *   { type: 'verified', trace }
 *       - self-verification finished in the background and the original
 *         answer held up. Nothing about the visible answer changes; this
 *         only updates the trace and flips `verified` to `true`.
 *   { type: 'revision_available', suggestedAnswer, suggestedSources, issue, trace }
 *       - self-verification found a problem and a corrected answer was
 *         generated, but it is NOT applied automatically - the original
 *         answer stays exactly as shown. A route handler surfaces this as
 *         an opt-in suggestion; a person can accept it (swapping the
 *         visible answer to the suggested one) or dismiss it and keep what
 *         they already have. This is a deliberate choice: silently
 *         rewriting an answer someone has already started reading, out
 *         from under them, feels like the app changed its mind on them,
 *         even when the rewrite is a genuine improvement.
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
 * SELF-VERIFICATION runs AFTER `done` has already been yielded - it never
 * blocks or interrupts the visible answer. One cheap batched call checks
 * whether the answer is actually supported by its sources; if not, ONE
 * revision is generated (not streamed - it's not shown until/unless
 * accepted) with the specific critique fed back into the prompt.
 * ENABLE_AGENTIC_RESEARCH_ON_REVISION (off by default) can additionally
 * drive a small follow-up search before regenerating, in agentic mode -
 * off by default because the extra planner round measurably adds to
 * latency for a correction a plain reword usually achieves anyway. The
 * whole background sequence (verify, optionally re-search, regenerate,
 * re-verify) is capped at BACKGROUND_VERIFICATION_TIMEOUT_MS (default
 * 20s) - past that it's abandoned rather than left running indefinitely;
 * the visible answer is entirely unaffected either way. Capped at a
 * single revision regardless of outcome - this is meant to catch genuine
 * mistakes, not loop indefinitely chasing a perfect score.
 *
 * `trace` (present when ENABLE_PIPELINE_TRACE is on) is a stage-by-stage
 * record of what the pipeline actually did for this query, built from data
 * already gathered during the run - producing it costs no extra API calls.
 * The trace attached to `done` never includes a verification stage yet
 * (it hasn't run); the trace attached to the later `verified` or
 * `revision_available` event is the complete one. See traceBuilder.js for
 * the fixed-pipeline shape and agenticRag.js / traceBuilder.js's
 * buildAgenticTrace for the agentic shape.
 */
// Caps the WORST CASE latency of the whole background verification +
// possible revision sequence, regardless of what's actually slow inside it
// (rate-limit retries, a slow agentic re-search, provider latency spikes,
// etc.) - past this, the background work is abandoned rather than left to
// run indefinitely. Nothing breaks when this fires: the answer already
// shown stays exactly as it is, `verified` just never gets its final
// true/false update for this message. Far better than a background check
// silently taking minutes.
const BACKGROUND_VERIFICATION_TIMEOUT_MS = parseInt(process.env.BACKGROUND_VERIFICATION_TIMEOUT_MS || '20000', 10);

/**
 * Runs self-verification and, if needed, generates a suggested revision -
 * everything that happens AFTER `done` has already been yielded. Returns a
 * single event object ({type: 'verified', ...} or {type: 'revision_available', ...})
 * or null if verification passed with nothing to report further. Extracted
 * into its own function (rather than inlined in the generator) specifically
 * so it can be raced against a timeout with Promise.race in
 * retrieveAndAnswerStream - a generator's multiple yields can't be raced
 * against a single timeout the same simple way a single returned promise can.
 */
async function runBackgroundVerification({ question, fullAnswer, finalSources, workingChunks, listsUsed, traceRaw, documentIds, history, streamStart }) {
  traceRaw.verificationEnabled = true;
  // A broad/multi-part question's answer necessarily synthesizes across
  // many sources in reworded language - a strict per-claim verification
  // check is more prone to false-positive on that kind of answer than on a
  // narrow single-fact one. See selfVerification.js's buildVerifyPrompt for
  // how this relaxes the check, not skips it - a genuinely wrong fact still
  // fails either way.
  const isBroad = BROAD_QUESTION_RE.test(question);

  let t = Date.now();
  const check = await verifyAnswer(question, fullAnswer, finalSources, { isBroad });
  traceRaw.verificationMs = Date.now() - t;
  traceRaw.verificationIssue = check.issue;

  if (check.passed) {
    traceRaw.verificationPassed = true;
    traceRaw.wasRevised = false;
    traceRaw.totalMs = Date.now() - streamStart;
    const trace = ENABLE_PIPELINE_TRACE
      ? traceRaw.mode === 'agentic' ? buildAgenticTrace(traceRaw) : buildTrace(traceRaw)
      : null;
    return { type: 'verified', verified: true, trace };
  }

  // Verification found a problem - generate a corrected answer, but as a
  // SUGGESTION, not a replacement. Not streamed: it isn't shown live, only
  // if/when it's accepted, so a single non-streaming call is simpler and
  // no worse for latency than accumulating a stream server-side would be.
  let revisedChunks = workingChunks;

  // Agentic mode CAN get one more chance to go find better source material
  // for the specific thing verification flagged, instead of only
  // rewording the same chunks - off by default (opt in via
  // ENABLE_AGENTIC_RESEARCH_ON_REVISION) because a full extra planner
  // round (up to 2 more tool-calling turns, each with its own multi-query
  // expansion and hybrid search) measurably adds to how long this
  // background step takes, for a correction that a plain reword usually
  // achieves anyway.
  const ENABLE_AGENTIC_RESEARCH_ON_REVISION = process.env.ENABLE_AGENTIC_RESEARCH_ON_REVISION === 'true';
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
        revisedChunks = ENABLE_DEDUPLICATION ? dedupeChunks(merged, DEDUP_SIMILARITY_THRESHOLD) : merged;
      }
    } catch (err) {
      console.warn(`[rag] re-search on revision failed (${err.message}), revising with the existing chunks only.`);
    }
  }

  const revision = { previousAnswer: fullAnswer, issues: check.issue };
  t = Date.now();
  const revisedAnswer = await generateAnswer(question, revisedChunks, history, revision);
  traceRaw.revisionGenerationMs = Date.now() - t;

  const revisedCitedNumbers = extractCitedSourceNumbers(revisedAnswer);
  const suggestedSources = buildSources(revisedChunks, listsUsed, revisedCitedNumbers);

  // A second check purely so the suggestion itself carries an honest
  // `verified` flag if accepted - does not trigger a further revision loop.
  t = Date.now();
  const secondCheck = await verifyAnswer(question, revisedAnswer, suggestedSources, { isBroad });
  traceRaw.secondVerificationMs = Date.now() - t;

  traceRaw.verificationPassed = secondCheck.passed;
  traceRaw.wasRevised = true;
  traceRaw.chunksUsedCount = revisedChunks.length;
  traceRaw.totalMs = Date.now() - streamStart;
  const trace = ENABLE_PIPELINE_TRACE
    ? traceRaw.mode === 'agentic' ? buildAgenticTrace(traceRaw) : buildTrace(traceRaw)
    : null;

  return {
    type: 'revision_available',
    suggestedAnswer: revisedAnswer,
    suggestedSources,
    suggestedVerified: secondCheck.passed,
    issue: check.issue,
    trace,
  };
}

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

  const workingChunks = chunks;
  let fullAnswer = '';
  let t = Date.now();
  for await (const textChunk of generateAnswerStream(question, workingChunks, history)) {
    fullAnswer += textChunk;
    yield { type: 'chunk', text: textChunk };
  }
  traceRaw.generationMs = Date.now() - t;
  traceRaw.chunksUsedCount = workingChunks.length;
  traceRaw.answerLength = fullAnswer.length;

  const citedNumbers = extractCitedSourceNumbers(fullAnswer);
  const finalSources = buildSources(workingChunks, listsUsed, citedNumbers);

  // The first answer is DONE as far as the person reading it is concerned -
  // yielded now, before verification has even started, so nothing about
  // what they're already reading can change out from under them.
  // `verified: null` specifically distinguishes "not checked yet" (this
  // case, when ENABLE_SELF_VERIFICATION is on) from `true`/`false`.
  const doneTrace = ENABLE_PIPELINE_TRACE
    ? traceRaw.mode === 'agentic' ? buildAgenticTrace(traceRaw) : buildTrace(traceRaw)
    : null;
  yield {
    type: 'done',
    answer: fullAnswer,
    sources: finalSources,
    verified: ENABLE_SELF_VERIFICATION ? null : true,
    wasRevised: false,
    trace: doneTrace,
  };

  if (!ENABLE_SELF_VERIFICATION) return;

  // Everything from here on runs AFTER `done` - strictly a background
  // check, bounded by BACKGROUND_VERIFICATION_TIMEOUT_MS. Nothing yielded
  // below should ever be interpreted as replacing what was already shown;
  // see the type-by-type contract in this function's doc comment above.
  const backgroundResult = await Promise.race([
    runBackgroundVerification({ question, fullAnswer, finalSources, workingChunks, listsUsed, traceRaw, documentIds, history, streamStart }),
    new Promise((resolve) => {
      setTimeout(() => resolve(null), BACKGROUND_VERIFICATION_TIMEOUT_MS);
    }),
  ]).catch((err) => {
    console.warn(`[rag] background verification failed (${err.message}), leaving the original answer as-is.`);
    return null;
  });

  if (backgroundResult) yield backgroundResult;
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
  BACKGROUND_VERIFICATION_TIMEOUT_MS,
};
