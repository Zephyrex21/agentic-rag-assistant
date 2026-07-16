const { getClient } = require('./geminiClient');
const { withModelFallback } = require('./modelFallback');
const { buildGenerationConfig } = require('./thinkingConfig');

// Deliberately the lighter/cheaper model - this is a mechanical rewrite task,
// not a reasoning task, so it doesn't need the same model as the real answer.
// gemini-3.1-flash-lite: stable GA, free tier, long runway (no shutdown
// before May 2027 as of this writing).
const MODEL = process.env.UTILITY_MODEL || 'gemini-3.1-flash-lite';
// Cross-paired with llm.js's default (reverse of its pairing) - two
// independent stable models covering each other, neither depends on the
// 2.5 line, which is where the actual instability has been.
const FALLBACK_MODEL = process.env.UTILITY_MODEL_FALLBACK || 'gemini-3.5-flash';

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
    const ai = getClient('utility');
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      ai.models.generateContent({
        model,
        contents: buildRewritePrompt(question, history),
        config: buildGenerationConfig(model, {
          temperature: 0.1,
          maxOutputTokens: 150, // this is a short rewrite, not an essay - headroom for thinking is added automatically where needed
        }),
      })
    );
    const rewritten = response.text?.trim();
    return rewritten || question;
  } catch (err) {
    console.warn('[queryRewriter] rewrite failed, falling back to original question:', err.message);
    return question;
  }
}

module.exports = { rewriteQuery, buildRewritePrompt, MODEL };
