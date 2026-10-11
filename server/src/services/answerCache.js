const embeddings = require('./embeddings');
const pinecone = require('./pinecone');
const answerCacheStore = require('../db/answerCacheStore');
const { parseFloatEnv } = require('../utils/envConfig');

const NAMESPACE = 'answer-cache';

// Deliberately high - a false-positive cache hit doesn't just look slightly
// off the way a middling retrieval result would, it silently hands someone
// a confidently-wrong answer under a question that felt like theirs. 0.94
// is roughly "same question, different wording" territory for the
// embedding model this app uses (jina-embeddings-v3), not merely "same
// topic" - tune down only if false MISSES (not hits) turn out to be the
// bigger problem in practice.
const SIMILARITY_THRESHOLD = parseFloatEnv('ANSWER_CACHE_SIMILARITY_THRESHOLD', 0.94, { min: 0, max: 1 });

/**
 * The exact same ownership boundary already used for document/retrieval
 * scoping (see rag.js's gatherCandidates and its 'guest' sentinel comment)
 * - reused here rather than reinvented, so a cache lookup can never cross
 * an owner boundary retrieval itself wouldn't.
 */
function buildOwnerKey(userId) {
  return userId || 'guest';
}

/** Sorted + joined so scope order never affects the cache key (asking
 * with documentIds [B, A] must hit the same entry as [A, B]) - 'ALL' for
 * an unscoped question, distinct from any real (even empty-after-filter)
 * document list. */
function buildDocSignature(documentIds) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return 'ALL';
  return [...documentIds].sort().join(',');
}

// Numbers, and short alphanumeric/mixed-case tokens that look like an
// identifier or code (E5, E6, IT2FS, GPT-4) rather than an ordinary
// English word - exactly the kind of token where two questions can be
// near-identical in EVERY other way ("what's the accuracy of E5" vs
// "what's the accuracy of E6") while asking about genuinely different
// things. Embedding similarity alone is not reliably sensitive to a
// single such token changing - this is a cheap, zero-API-cost second
// check specifically for that failure mode, not a general dedup heuristic.
const DISTINGUISHING_TOKEN_RE = /\b(?:[A-Za-z]{0,4}\d[\w-]*|[A-Z]{2,}\d*)\b/g;

function extractDistinguishingTokens(text) {
  // Match against the ORIGINAL casing, not uppercased - the whole point of
  // the second regex alternative is "already looked like an acronym before
  // we touched it" (E5, IT2FS), which is meaningless information once
  // every ordinary word has also been forced to uppercase first. Only
  // normalize case on the tokens actually captured, so "e5" and "E5" in
  // two different phrasings of the same question still compare equal.
  const matches = text.match(DISTINGUISHING_TOKEN_RE) || [];
  return new Set(matches.map((m) => m.toUpperCase()));
}

/** True if two questions' distinguishing tokens are identical sets (order
 * doesn't matter, absence on both sides is a match too - most questions
 * have none, and that's fine, it just means this check has nothing to add
 * beyond the embedding similarity for that pair). */
function tokensMatch(questionA, questionB) {
  const a = extractDistinguishingTokens(questionA);
  const b = extractDistinguishingTokens(questionB);
  if (a.size !== b.size) return false;
  for (const token of a) {
    if (!b.has(token)) return false;
  }
  return true;
}

/**
 * Checks for a cached answer to a semantically-equivalent question already
 * asked within the same owner+document scope. Returns null on anything
 * short of a confident match (below the similarity threshold, a
 * distinguishing-token mismatch, or the Pinecone match's row having since
 * been deleted) - always safe to treat a null return as "run the real
 * pipeline," which is exactly what every call site does.
 *
 * Costs exactly one embedding call (already a cheap, high-free-tier-limit
 * operation this app makes on every question anyway for retrieval) and one
 * Pinecone query (same index this app already pays nothing extra for) -
 * the entire point is that a HIT then skips query rewriting, expansion,
 * retrieval, reranking, generation, AND verification: several Groq calls,
 * against the exact rate limit this feature exists to relieve pressure on.
 */
async function lookup({ question, userId, documentIds }) {
  try {
    const ownerKey = buildOwnerKey(userId);
    const docSignature = buildDocSignature(documentIds);

    const vector = await embeddings.embedOne(question, 'RETRIEVAL_QUERY');
    const matches = await pinecone.queryVectors(
      vector,
      1,
      { ownerKey: { $eq: ownerKey }, docSignature: { $eq: docSignature } },
      NAMESPACE
    );
    const best = matches[0];
    if (!best || (best.score ?? 0) < SIMILARITY_THRESHOLD) return null;

    const cached = await answerCacheStore.findById(best.id);
    // Never serve an ungrounded entry. Rows with zero sources were written
    // by an earlier bug (a skipped search produced a "no info" answer that
    // passed verification trivially) - ignoring them here heals the cache
    // without anyone having to purge it by hand.
    // The Pinecone vector and the Postgres row are written together (see
    // write() below) but deleted independently in places (e.g. a document
    // removal only cleans up cache rows scoped to it, not yet its
    // Pinecone siblings in every code path) - a dangling vector with no
    // matching row is treated as a miss, not an error.
    if (!cached) return null;
    if (!Array.isArray(cached.sources) || cached.sources.length === 0) return null;
    if (!tokensMatch(question, cached.question)) return null;

    answerCacheStore.recordHit(cached.id).catch((err) => console.warn(`[answerCache] recordHit failed: ${err.message}`));

    return {
      answer: cached.answer,
      sources: cached.sources,
      similarity: best.score,
      hitCount: cached.hitCount + 1,
      cachedQuestion: cached.question,
      createdAt: cached.createdAt,
    };
  } catch (err) {
    // A cache-layer failure should never be the reason a real question
    // doesn't get answered - log and fall through to the normal pipeline,
    // exactly as if this had been a plain miss.
    console.warn(`[answerCache] lookup failed (${err.message}) - proceeding without cache.`);
    return null;
  }
}

/**
 * Stores a freshly-generated, already-verified-or-verification-not-in-use
 * answer for future reuse. Deliberately fire-and-forget from every call
 * site (see rag.js) - never something worth delaying a response the
 * person is already reading over.
 */
async function write({ question, answer, sources, userId, documentIds }) {
  // An answer with no sources was never grounded in the documents (small
  // talk, or a search that was skipped/found nothing) - caching it would
  // replay that non-answer for every future near-duplicate question, long
  // after whatever caused it is fixed.
  if (!Array.isArray(sources) || sources.length === 0) return;
  try {
    const ownerKey = buildOwnerKey(userId);
    const docSignature = buildDocSignature(documentIds);

    const id = await answerCacheStore.insert({ ownerKey, docSignature, question, answer, sources });
    const vector = await embeddings.embedOne(question, 'RETRIEVAL_QUERY');
    await pinecone.upsertVectors([{ id, values: vector, metadata: { ownerKey, docSignature } }], NAMESPACE);
  } catch (err) {
    console.warn(`[answerCache] write failed (${err.message}) - the answer itself was still returned normally.`);
  }
}

module.exports = { lookup, write, buildOwnerKey, buildDocSignature, extractDistinguishingTokens, tokensMatch, SIMILARITY_THRESHOLD };
