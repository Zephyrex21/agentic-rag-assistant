const { getClient } = require('./groqClient');
const { withModelFallback } = require('./modelFallback');
const { parseIntEnv } = require('../utils/envConfig');

// Same lighter/cheaper model as reranking/rewriting/verification - this is
// a mechanical rephrasing task, not a reasoning task.
const MODEL = process.env.UTILITY_MODEL || 'llama-3.1-8b-instant';
const FALLBACK_MODEL = process.env.UTILITY_MODEL_FALLBACK || 'openai/gpt-oss-20b';

// How many EXTRA phrasings to generate, on top of the original/rewritten
// query. Kept small by default - each extra phrasing costs one more
// embedding call + one more keyword search (run in parallel, so latency
// impact is small, but there's no reason to go wide here) for a recall
// benefit that diminishes fast past 2-3 variants.
const EXPANSION_COUNT = parseIntEnv('QUERY_EXPANSION_COUNT', 2, { min: 0 });

function buildExpansionPrompt(question, count) {
  return `Generate ${count} alternative phrasings of the question below. Each one should use different wording, synonyms, or phrasing style than the original - the goal is to help a search system that matches on BOTH exact keywords and semantic meaning find relevant passages it might miss if it only saw the original phrasing.

Rules:
- Do NOT change what's being asked or introduce new questions - only reword.
- Vary vocabulary and sentence structure meaningfully between the ${count} versions, not just tiny tweaks.
- Keep each one a natural, complete question.

Question: "${question}"

Respond with ONLY a JSON array of ${count} strings, no other text.
Example format: ["rephrased version one", "rephrased version two"]

JSON array:`;
}

/**
 * Parses the model's JSON-array response into a clean string array. Pure
 * function, separated from the API call so parsing robustness (malformed
 * JSON, wrong types, too many/few items) can be unit tested without a
 * network call.
 */
function parseExpansionResponse(raw, count) {
  const jsonMatch = (raw || '').match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((q) => typeof q === 'string' && q.trim().length > 0)
    .map((q) => q.trim())
    .slice(0, count);
}

/**
 * Generates alternate phrasings of a search query for multi-query
 * retrieval - each phrasing runs through the same hybrid search
 * independently in rag.js, and all result lists get fused together with
 * RRF (which already supports fusing N ranked lists, not just two). This
 * catches cases where the user's exact wording doesn't match the
 * document's vocabulary but a rephrasing would.
 *
 * Fails soft: returns an empty array on any error, so callers just fall
 * back to searching with the original query alone - same philosophy as
 * queryRewriter.js and reranker.js.
 *
 * @param {string} question - the query to generate variants of (already
 *   rewritten to be standalone, if query rewriting is enabled)
 * @param {number} count - how many variants to generate
 * @returns {Promise<string[]>}
 */
async function expandQuery(question, count = EXPANSION_COUNT) {
  if (count <= 0) return [];

  try {
    const client = getClient();
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: buildExpansionPrompt(question, count) }],
        temperature: 0.5, // some lexical variety is the whole point here, unlike rewrite/rerank's determinism
        max_completion_tokens: 250,
      })
    );
    return parseExpansionResponse(response.choices?.[0]?.message?.content, count);
  } catch (err) {
    console.warn('[queryExpansion] expansion failed, continuing with the original query only:', err.message);
    return [];
  }
}

module.exports = { expandQuery, buildExpansionPrompt, parseExpansionResponse, MODEL, EXPANSION_COUNT };
