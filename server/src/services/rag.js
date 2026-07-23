const { embedOne } = require('./embeddings');
const { queryVectors } = require('./pinecone');
const { keywordSearch } = require('./keywordSearch');
const { reciprocalRankFusion, normalizeRrfScore } = require('./rrf');
const { rewriteQuery } = require('./queryRewriter');
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

// Every stage of the Phase 6 pipeline is independently toggleable, so you
// can compare quality with/without each one, or turn off a stage if latency
// or free-tier quota ever gets tight - none of these require touching code.
const ENABLE_QUERY_REWRITE = process.env.ENABLE_QUERY_REWRITE !== 'false';
const ENABLE_HYBRID_SEARCH = process.env.ENABLE_HYBRID_SEARCH !== 'false';
const ENABLE_RERANKING = process.env.ENABLE_RERANKING !== 'false';
const ENABLE_SELF_VERIFICATION = process.env.ENABLE_SELF_VERIFICATION !== 'false';

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
 * Runs vector search (always) and keyword search (if hybrid enabled) in
 * parallel, normalizes both result shapes to the same fields, and returns
 * both the ranked ID lists (for RRF) and a lookup map (to recover full
 * chunk data after fusion, since RRF itself only deals with IDs + scores).
 */
async function gatherCandidates(searchQuery, documentIds) {
  const filter = Array.isArray(documentIds) && documentIds.length > 0
    ? { documentId: { $in: documentIds } }
    : undefined;

  const vectorPromise = embedOne(searchQuery, 'RETRIEVAL_QUERY').then((vector) =>
    queryVectors(vector, CANDIDATE_POOL, filter)
  );
  const keywordPromise = ENABLE_HYBRID_SEARCH
    ? keywordSearch(searchQuery, CANDIDATE_POOL, documentIds)
    : Promise.resolve([]);

  const [vectorMatches, keywordMatches] = await Promise.all([vectorPromise, keywordPromise]);

  const vectorList = vectorMatches.map((m) => ({ id: m.id }));
  const keywordList = keywordMatches.map((m) => ({ id: m.id }));

  const lookup = new Map();
  for (const m of vectorMatches) {
    lookup.set(m.id, {
      id: m.id,
      documentId: m.metadata.documentId,
      filename: m.metadata.filename,
      chunkIndex: m.metadata.chunkIndex,
      section: m.metadata.section,
      text: m.metadata.text,
    });
  }
  for (const m of keywordMatches) {
    if (!lookup.has(m.id)) {
      lookup.set(m.id, {
        id: m.id,
        documentId: m.documentId,
        filename: m.filename,
        chunkIndex: m.chunkIndex,
        section: m.section,
        text: m.text,
      });
    }
  }

  const listsUsed = ENABLE_HYBRID_SEARCH ? [vectorList, keywordList] : [vectorList];
  return { listsUsed, lookup };
}

/**
 * Shared retrieval pipeline used by both the streaming and non-streaming
 * answer paths: rewrite -> gather -> fuse -> rerank. Returns null chunks
 * (with the "not enough info" answer) if nothing relevant was found, so
 * both callers can check `chunks === null` the same way.
 */
async function retrieveChunks(question, { documentIds, history = [] } = {}) {
  const searchQuery = ENABLE_QUERY_REWRITE ? await rewriteQuery(question, history) : question;

  const { listsUsed, lookup } = await gatherCandidates(searchQuery, documentIds);
  const fused = reciprocalRankFusion(listsUsed);

  if (fused.length === 0) {
    return { chunks: null, searchQuery, listsUsed };
  }

  const candidatePool = fused
    .slice(0, CANDIDATE_POOL)
    .map((f) => ({ ...lookup.get(f.id), rrfScore: f.rrfScore }))
    .filter((c) => c.id);

  let finalChunks;
  if (ENABLE_RERANKING) {
    finalChunks = await rerank(searchQuery, candidatePool, TOP_K);
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
        finalChunks = candidatePool.slice(0, TOP_K);
      } else {
        return { chunks: null, searchQuery, listsUsed };
      }
    }
  } else {
    const topNormalized = normalizeRrfScore(candidatePool[0].rrfScore, listsUsed.length);
    if (topNormalized < MIN_RELEVANCE_SCORE) {
      return { chunks: null, searchQuery, listsUsed };
    }
    finalChunks = candidatePool.slice(0, TOP_K);
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

module.exports = { retrieveAndAnswerStream, NO_INFO_ANSWER, extractCitedSourceNumbers };
