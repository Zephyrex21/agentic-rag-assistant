const { getClient } = require('./geminiClient');
const { withModelFallback } = require('./modelFallback');
const { buildGenerationConfig } = require('./thinkingConfig');

const MODEL = process.env.UTILITY_MODEL || 'gemini-3.1-flash-lite';
// Cross-paired with llm.js's default - see queryRewriter.js for the same reasoning.
const FALLBACK_MODEL = process.env.UTILITY_MODEL_FALLBACK || 'gemini-3.5-flash';

// Reranker only needs enough text to judge relevance, not the full chunk -
// full text is still used for the actual answer generation step afterward.
const EXCERPT_WORDS_FOR_RERANK = 120;

function truncateForRerank(text) {
  const words = text.split(/\s+/);
  return words.length <= EXCERPT_WORDS_FOR_RERANK ? text : `${words.slice(0, EXCERPT_WORDS_FOR_RERANK).join(' ')}...`;
}

function buildRerankPrompt(question, candidates) {
  const list = candidates
    .map((c, i) => `[${i + 1}] (${c.filename}${c.section ? ` - ${c.section}` : ''}): ${truncateForRerank(c.text)}`)
    .join('\n\n');

  return `Question: "${question}"

Below are ${candidates.length} candidate passages. Identify which ones would help answer the question.

Broad or overview-style questions (e.g. "what is this about", "summarize this", "what does this cover")
are answered by combining multiple passages, not by any single one fully answering it - for these,
include any passage that describes the subject, its purpose, or its main features, even if it's only
part of a fuller answer. Reserve an empty result for when the passages are genuinely about a different
topic entirely, not just partial or high-level relative to the question.

${list}

Respond with ONLY a JSON array of the relevant passage numbers, ordered from most to least relevant. Maximum 6 numbers. If none are relevant, respond with an empty array [].
Example format: [3, 1, 7]

JSON array:`;
}

/**
 * Parses the model's JSON-array response into actual candidate objects.
 * Pure function, deliberately separated from the API call so the parsing
 * robustness (malformed JSON, out-of-range indices, non-array output) can
 * be unit tested without hitting the network.
 */
function parseRerankResponse(raw, candidates, topK) {
  const jsonMatch = (raw || '').match(/\[[\d,\s]*\]/);
  if (!jsonMatch) {
    return candidates.slice(0, topK);
  }

  let indices;
  try {
    indices = JSON.parse(jsonMatch[0]);
  } catch {
    return candidates.slice(0, topK);
  }

  if (!Array.isArray(indices)) {
    return candidates.slice(0, topK);
  }

  return indices
    .map((n) => candidates[n - 1]) // model outputs are 1-indexed to match the prompt
    .filter(Boolean)
    .slice(0, topK);
}

/**
 * Reranks fused candidates with a single batched LLM call (not one call per
 * candidate - this is the token-efficiency choice that makes reranking
 * affordable). Returns the subset of candidates judged actually relevant,
 * in relevance order.
 *
 * Fails soft: if the model call fails, returns the original candidate list
 * untouched (capped to topK) rather than blocking the query - a broken
 * reranker should degrade gracefully, not take retrieval down with it.
 *
 * @param {string} question
 * @param {Array<{id: string, filename: string, section?: string, text: string}>} candidates
 * @param {number} topK - max results to keep after reranking
 */
async function rerank(question, candidates, topK = 5) {
  if (candidates.length === 0) return [];

  try {
    const ai = getClient('utility');
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      ai.models.generateContent({
        model,
        contents: buildRerankPrompt(question, candidates),
        config: buildGenerationConfig(model, {
          temperature: 0, // determinism matters here (gemini-2.5.x only - omitted for gemini-3.x per Google's guidance)
          maxOutputTokens: 150, // just a JSON array of numbers - headroom for thinking added automatically where needed
        }),
      })
    );

    return parseRerankResponse(response.text, candidates, topK);
  } catch (err) {
    console.warn('[reranker] rerank call failed, falling back to unranked top-K:', err.message);
    return candidates.slice(0, topK);
  }
}

module.exports = { rerank, buildRerankPrompt, parseRerankResponse, MODEL };
