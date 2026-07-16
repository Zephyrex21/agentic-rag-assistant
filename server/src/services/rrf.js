// Standard RRF constant from the literature - dampens the impact of any
// single rank position so one method's #1 result doesn't automatically
// dominate a chunk that ranks #3 in both lists.
const RRF_K = 60;

/**
 * Fuses multiple ranked result lists into one, using Reciprocal Rank Fusion.
 * A chunk that appears in BOTH the vector and keyword results (even at
 * middling ranks in each) will typically outscore a chunk that only won
 * on one method - which is the entire point of hybrid search.
 *
 * @param {Array<Array<{id: string}>>} rankedLists - one array per retrieval
 *   method, each already sorted best-first. Items just need a stable `id`.
 * @returns {Array<{id: string, rrfScore: number}>} sorted best-first, deduped by id
 */
function reciprocalRankFusion(rankedLists) {
  const scores = new Map();

  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const rank = index + 1; // 1-indexed rank
      const contribution = 1 / (RRF_K + rank);
      scores.set(item.id, (scores.get(item.id) || 0) + contribution);
    });
  }

  return [...scores.entries()]
    .map(([id, rrfScore]) => ({ id, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Normalizes RRF scores to a 0-1 range for consistent display alongside
 * the old cosine-similarity scores the frontend already expects.
 * The max possible single-list contribution is 1/(RRF_K+1), so a chunk
 * appearing at rank 1 in N lists caps at N/(RRF_K+1) - we normalize against
 * that theoretical max given how many lists were actually fused.
 */
function normalizeRrfScore(rrfScore, listCount) {
  const maxPossible = listCount / (RRF_K + 1);
  if (maxPossible === 0) return 0;
  return Math.min(1, rrfScore / maxPossible);
}

module.exports = { reciprocalRankFusion, normalizeRrfScore, RRF_K };
