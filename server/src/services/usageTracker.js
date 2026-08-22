/**
 * Lightweight, in-memory usage tracking for the two free-tier-limited
 * resources this project actually depends on: Groq (generation/utility
 * LLM calls) and Jina (embeddings). The gap this closes: an agentic query
 * can easily spend 5-10 Groq calls (planner turns, rewriting, expansion,
 * reranking, generation, background verification) and several Jina calls
 * (multi-query embedding, agentic search embeddings) with zero visibility
 * into how much of a free-tier quota that's actually consuming - the only
 * way to notice was hitting a 429 and wondering why.
 *
 * Deliberately in-memory, not persisted: this resets on every server
 * restart. That's a real limitation (see GET /api/usage's response noting
 * `since`), but a genuinely persistent usage ledger is a much bigger
 * feature (its own table, migration, retention policy) for what's meant
 * to be a lightweight "am I anywhere near a quota wall" signal, not a
 * billing system. If you need cross-restart history, each provider's own
 * dashboard (console.groq.com, jina.ai) already has that.
 */

const startedAt = Date.now();

const groqCallsByModel = new Map();
let jinaEmbeddingCalls = 0;
let jinaTextsEmbedded = 0;

function recordGroqCall(model) {
  if (!model) return;
  groqCallsByModel.set(model, (groqCallsByModel.get(model) || 0) + 1);
}

/**
 * @param {number} [textCount] - how many texts were in this one embedding
 *   request (Jina's API accepts a batch) - tracked separately from call
 *   count since a single call can embed dozens of chunks during ingestion,
 *   which is a very different quota impact than a single query embedding.
 */
function recordJinaCall(textCount = 1) {
  jinaEmbeddingCalls += 1;
  jinaTextsEmbedded += textCount;
}

function getUsageSummary() {
  return {
    since: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    groq: {
      totalCalls: [...groqCallsByModel.values()].reduce((sum, n) => sum + n, 0),
      byModel: Object.fromEntries(groqCallsByModel),
    },
    jina: {
      totalCalls: jinaEmbeddingCalls,
      totalTextsEmbedded: jinaTextsEmbedded,
    },
  };
}

// Exposed purely for tests - resets counters without needing a fresh
// require() of the module (which node's module cache would otherwise
// share the same counters across test files anyway).
function _resetForTests() {
  groqCallsByModel.clear();
  jinaEmbeddingCalls = 0;
  jinaTextsEmbedded = 0;
}

module.exports = { recordGroqCall, recordJinaCall, getUsageSummary, _resetForTests };
