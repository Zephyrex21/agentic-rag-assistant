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

const TOP_K = parseInt(process.env.RETRIEVAL_TOP_K || '5', 10);
const CANDIDATE_POOL = parseInt(process.env.RETRIEVAL_CANDIDATE_POOL || '15', 10);
const MIN_RELEVANCE_SCORE = parseFloat(process.env.MIN_RELEVANCE_SCORE || '0.35');
// Lower and deliberately distinct from MIN_RELEVANCE_SCORE above - this only
// gates the rerank-rejected-everything rescue path (see retrieveChunks),
// not the primary retrieval decision. Kept lenient on purpose: the failure
// mode being guarded against is a false "I don't know" from an overly
// strict reranker judgment on a broad question, not weak/irrelevant matches.
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

// Heuristic, not an LLM call on purpose - this only needs to catch the
// broad-question SHAPE (summaries, overviews, comparisons, "everything/all"
// asks), not truly understand the question, and a regex costs zero extra
// latency/tokens versus asking a model to classify it. Mirrors the same
// "broad question" concept the rerank prompt already reasons about in
// reranker.js - this just also widens how many chunks survive to get there.
const BROAD_QUESTION_RE =
  /\b(summarize|summarise|overview|everything|all of|entire|compare|comparison|difference between|list all|each|every|explain (the )?(whole|full)|what does .* cover|tell me about)\b/i;

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
 * metadata-normalization logic per variant.
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
  return { lists, entries };
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
  for (const { lists, entries } of perQueryResults) {
    for (const [id, value] of entries) {
      if (!lookup.has(id)) lookup.set(id, value);
    }
    listsUsed.push(...lists);
  }

  return { listsUsed, lookup };
}

/**
 * Shared retrieval pipeline used by both the streaming and non-streaming
 * answer paths: rewrite -> expand -> gather -> fuse -> dedupe -> rerank.
 * Returns null chunks (with the "not enough info" answer) if nothing
 * relevant was found, so both callers can check `chunks === null` the same way.
 */
async function retrieveChunks(question, { documentIds, history = [] } = {}) {
  const searchQuery = ENABLE_QUERY_REWRITE ? await rewriteQuery(question, history) : question;

  // Multi-query retrieval: search with the original query AND a few
  // alternate phrasings in parallel, so wording that doesn't match the
  // document's exact vocabulary still has other angles to land on. All
  // variants' results get fused together by RRF below - a chunk multiple
  // variants agree on naturally outranks one only a single phrasing found.
  const expandedQueries = ENABLE_QUERY_EXPANSION ? await expandQuery(searchQuery) : [];
  const queries = [searchQuery, ...expandedQueries];

  const { listsUsed, lookup } = await gatherCandidates(queries, documentIds);
  const fused = reciprocalRankFusion(listsUsed);

  if (fused.length === 0) {
    return { chunks: null, searchQuery, listsUsed };
  }

  const fusedPool = fused
    .slice(0, CANDIDATE_POOL)
    .map((f) => ({ ...lookup.get(f.id), rrfScore: f.rrfScore }))
    .filter((c) => c.id);

  // Drop near-duplicate passages before they eat a slot in the reranker's
  // limited candidate budget - more likely to happen now that multi-query
  // retrieval searches the same corpus from several angles at once.
  const candidatePool = ENABLE_DEDUPLICATION ? dedupeChunks(fusedPool, DEDUP_SIMILARITY_THRESHOLD) : fusedPool;

  const topK = computeTopK(searchQuery);

  let finalChunks;
  if (ENABLE_RERANKING) {
    finalChunks = await rerank(searchQuery, candidatePool, topK);
    if (finalChunks.length === 0) {
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
      } else {
        return { chunks: null, searchQuery, listsUsed };
      }
    }
  } else {
    const topNormalized = normalizeRrfScore(candidatePool[0].rrfScore, listsUsed.length);
    if (topNormalized < MIN_RELEVANCE_SCORE) {
      return { chunks: null, searchQuery, listsUsed };
    }
    finalChunks = candidatePool.slice(0, topK);
  }

  return { chunks: finalChunks, searchQuery, listsUsed };
}

function buildSources(finalChunks, listsUsed, citedNumbers) {
  return finalChunks.map((c, i) => {
    const sourceNumber = i + 1;
    const displayScore = c.rrfScore !== undefined ? normalizeRrfScore(c.rrfScore, listsUsed.length) : 0;
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
 * Streaming retrieve-then-answer pipeline. Retrieval itself (rewrite, search,
 * fuse, rerank) is NOT streamed - it's fast enough that streaming it wouldn't
 * meaningfully help, and streaming only the generation step keeps this much
 * simpler. Yields events for a route handler to forward as SSE:
 *   { type: 'sources', sources }  - as soon as retrieval completes (cited flags not yet known)
 *   { type: 'chunk', text }       - repeated, as the answer streams in (fired again
 *                                    for a revision pass, if one happens)
 *   { type: 'revising', issue }   - self-verification found a problem; a corrected
 *                                    answer is about to stream in, replacing this one
 *   { type: 'done', answer, sources, verified, wasRevised } - final state
 *   { type: 'no_info' }           - nothing relevant found, no generation call made
 *
 * Self-verification runs after a first answer streams in: one cheap batched
 * call checks whether the answer is actually supported by its sources. If
 * not, ONE revision pass runs with the specific critique fed back into the
 * prompt, and streams in as a visible correction rather than a silent retry.
 * Capped at a single revision regardless of outcome - this is meant to catch
 * genuine mistakes, not loop indefinitely chasing a perfect score.
 */
async function* retrieveAndAnswerStream(question, options = {}) {
  const { chunks, listsUsed } = await retrieveChunks(question, options);

  if (!chunks) {
    yield { type: 'no_info', answer: NO_INFO_ANSWER };
    return;
  }

  const preliminarySources = buildSources(chunks, listsUsed, new Set());
  yield { type: 'sources', sources: preliminarySources };

  const history = options.history || [];
  let fullAnswer = '';
  for await (const textChunk of generateAnswerStream(question, chunks, history)) {
    fullAnswer += textChunk;
    yield { type: 'chunk', text: textChunk };
  }

  let citedNumbers = extractCitedSourceNumbers(fullAnswer);
  let finalSources = buildSources(chunks, listsUsed, citedNumbers);
  let verified = true;
  let wasRevised = false;

  if (ENABLE_SELF_VERIFICATION) {
    const check = await verifyAnswer(question, fullAnswer, finalSources);

    if (!check.passed) {
      yield { type: 'revising', issue: check.issue };

      let revisedAnswer = '';
      const revision = { previousAnswer: fullAnswer, issues: check.issue };
      for await (const textChunk of generateAnswerStream(question, chunks, history, revision)) {
        revisedAnswer += textChunk;
        yield { type: 'chunk', text: textChunk };
      }

      fullAnswer = revisedAnswer;
      citedNumbers = extractCitedSourceNumbers(fullAnswer);
      finalSources = buildSources(chunks, listsUsed, citedNumbers);
      wasRevised = true;

      // One more check on the revised answer, purely for the `verified`
      // flag shown in the UI - does NOT trigger a second revision loop.
      const secondCheck = await verifyAnswer(question, fullAnswer, finalSources);
      verified = secondCheck.passed;
    }
  }

  yield { type: 'done', answer: fullAnswer, sources: finalSources, verified, wasRevised };
}

module.exports = { retrieveAndAnswerStream, NO_INFO_ANSWER, extractCitedSourceNumbers, computeTopK, BROAD_QUESTION_RE };
