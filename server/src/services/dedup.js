const { parseFloatEnv } = require('../utils/envConfig');

// Similarity threshold above which two chunks are considered near-duplicates.
// 0.82 was picked empirically as "high enough that legitimately distinct
// passages about the same topic don't collide, low enough to catch
// near-identical text" - see test-dedup.js for the boundary cases this
// covers (overlapping chunk windows, repeated boilerplate, genuinely
// distinct passages that merely share vocabulary).
const DEFAULT_THRESHOLD = parseFloatEnv('DEDUP_SIMILARITY_THRESHOLD', 0.82, { min: 0, max: 1 });

/**
 * Tokenizes text into a lowercase word set. Punctuation-insensitive and
 * order-insensitive on purpose - this is a cheap "are these roughly the
 * same bag of words" check, not a real similarity model.
 */
function wordSet(text) {
  return new Set((text || '').toLowerCase().match(/[a-z0-9]+/g) || []);
}

/**
 * Jaccard similarity: intersection size over union size, 0-1. Symmetric,
 * and deliberately simple - no embeddings, no extra API calls, cheap
 * enough to run on every query's candidate pool (typically 15-45 items
 * with multi-query retrieval) without adding meaningful latency.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Drops near-duplicate chunks from a ranked candidate pool, keeping the
 * highest-ranked copy of each near-duplicate group.
 *
 * Why this matters: multi-query retrieval (queryExpansion.js) runs several
 * phrasings of the same question through search in parallel - the same or a
 * heavily-overlapping passage can easily surface under two DIFFERENT chunk
 * IDs (e.g. two overlapping word-window chunks from chunking.js, or the same
 * paragraph matched by more than one query variant). RRF's fusion only
 * dedupes by exact chunk ID, so it can't catch this - two distinct IDs with
 * near-identical text both survive fusion and would otherwise both eat a
 * slot in the reranker's limited candidate budget.
 *
 * Expects `candidates` already sorted best-first (e.g. by RRF score) -
 * keeps the FIRST occurrence of each near-duplicate group, which is why
 * ordering matters.
 *
 * @param {Array<{text: string}>} candidates - sorted best-first
 * @param {number} threshold - Jaccard similarity at/above which two chunks count as duplicates
 * @returns {Array} the deduplicated candidates, original order preserved
 */
function dedupeChunks(candidates, threshold = DEFAULT_THRESHOLD) {
  if (!Array.isArray(candidates) || candidates.length === 0) return candidates || [];

  const kept = [];
  const keptWordSets = [];

  for (const candidate of candidates) {
    const words = wordSet(candidate?.text);
    const isDuplicate = keptWordSets.some((keptWords) => jaccardSimilarity(words, keptWords) >= threshold);
    if (!isDuplicate) {
      kept.push(candidate);
      keptWordSets.push(words);
    }
  }

  return kept;
}

module.exports = { dedupeChunks, jaccardSimilarity, wordSet, DEFAULT_THRESHOLD };
