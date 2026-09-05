const { getClient } = require('./groqClient');
const { withModelFallback } = require('./modelFallback');

// Deliberately the lighter/cheaper model - this is a mechanical rewrite task,
// not a reasoning task, so it doesn't need the same model as the real answer.
// Groq has fully deprecated llama-3.1-8b-instant (see modelFallback.js's
// KNOWN_PROBLEMATIC_MODELS) - gpt-oss-20b is both the replacement Groq
// itself recommends and the one with the highest free-tier TPM ceiling of
// the models this app uses, which matters more for reliability than model
// choice does for a mechanical task like this.
const MODEL = process.env.UTILITY_MODEL || 'openai/gpt-oss-20b';
// The larger sibling, not a different family - Llama's no longer a viable
// second family for anything on Groq (see above), so the only remaining
// cross-provider fallback lives one level up, in llm.js's Mistral tier.
const FALLBACK_MODEL = process.env.UTILITY_MODEL_FALLBACK || 'openai/gpt-oss-120b';

function buildRewritePrompt(question, history) {
  const historyText = history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  return `Rewrite the LATEST question as a standalone question that makes sense with no prior context, using the conversation to resolve pronouns and vague references ("it", "that", "the second one").

Rules:
- Output ONLY the rewritten question. No preamble, no quotes, no explanation.
- If the latest question is already standalone, output it unchanged.
- Keep it concise - do not add information that wasn't implied by the conversation.

CONVERSATION:
${historyText}

LATEST QUESTION: ${question}

REWRITTEN:`;
}

/**
 * Expands a context-dependent follow-up into a standalone question, so
 * retrieval isn't just embedding "what about the second one?" and hoping
 * for the best. Only call this when there IS history - skip it entirely on
 * first messages, which is the common case and where this would be wasted cost.
 *
 * Fails soft: if the rewrite call errors for any reason, returns the
 * original question unchanged rather than blocking the whole query.
 */
async function rewriteQuery(question, history) {
  if (!history || history.length === 0) return question;

  try {
    const client = getClient();
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: buildRewritePrompt(question, history) }],
        temperature: 0.1,
        max_completion_tokens: 150, // this is a short rewrite, not an essay
      })
    );
    const rewritten = response.choices?.[0]?.message?.content?.trim();
    return rewritten || question;
  } catch (err) {
    console.warn('[queryRewriter] rewrite failed, falling back to original question:', err.message);
    return question;
  }
}

module.exports = { rewriteQuery, buildRewritePrompt, MODEL };
