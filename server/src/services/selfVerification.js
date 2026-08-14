const { getClient } = require('./groqClient');
const { withModelFallback, parseGroqError } = require('./modelFallback');

// Same lighter model as reranking/rewriting - this is a judgment task, not
// a reasoning task, and needs to stay cheap since it runs on every answer.
const MODEL = process.env.UTILITY_MODEL || 'llama-3.1-8b-instant';
const FALLBACK_MODEL = process.env.UTILITY_MODEL_FALLBACK || 'openai/gpt-oss-20b';

const EXCERPT_WORDS_FOR_VERIFY = 150;

function truncateForVerify(text) {
  const words = text.split(/\s+/);
  return words.length <= EXCERPT_WORDS_FOR_VERIFY ? text : `${words.slice(0, EXCERPT_WORDS_FOR_VERIFY).join(' ')}...`;
}

function buildVerifyPrompt(question, answer, sources, { isBroad = false } = {}) {
  const sourceList = sources
    .map((s, i) => `[Source ${i + 1}: ${s.filename}${s.section ? ` - ${s.section}` : ''}]\n${truncateForVerify(s.fullText || s.text)}`)
    .join('\n\n---\n\n');

  const broadNote = isBroad
    ? `\nThis is a broad, multi-part question - a good answer is expected to synthesize and summarize across many sources, in different words than any single source uses, and to cover several distinct points in one answer. That range and rewording is exactly what a good answer SHOULD do here, not a reason to fail it.\n`
    : '';

  return `Question: "${question}"

Proposed answer:
"${answer}"

Sources the answer is supposed to be based on:
${sourceList}
${broadNote}
Check the proposed answer against the sources. Two things disqualify it:
1. A specific factual claim (a number, name, date, or concrete detail) that isn't actually stated in any source, or that contradicts what a source says.
2. The answer doesn't actually address the question that was asked.

Do NOT flag reasonable summarization, paraphrasing, rewording, or combining information across multiple sources - that's expected and fine even when the wording differs from the sources, and even when the answer covers many points at once. Only flag a genuine unsupported/contradicted factual claim or a non-answer - not a stylistic or coverage difference.

Respond with ONLY a JSON object in this exact shape, no other text:
{"passed": true} or {"passed": false, "issue": "one sentence describing the specific unsupported claim or problem"}

JSON:`;
}

/**
 * Parses the model's verification response. Pure function, separated from
 * the API call so parsing robustness can be tested without network access.
 * Fails OPEN (treats as passed) on any parsing failure - a broken verifier
 * should never be the reason a perfectly good answer gets held back or
 * endlessly revised.
 */
function parseVerifyResponse(raw) {
  const jsonMatch = (raw || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { passed: true, issue: null };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.passed === false && typeof parsed.issue === 'string' && parsed.issue.trim()) {
      return { passed: false, issue: parsed.issue.trim() };
    }
    return { passed: true, issue: null };
  } catch {
    return { passed: true, issue: null };
  }
}

/**
 * Checks whether an answer is actually supported by the sources it was
 * generated from. Fails soft in every direction - if this call errors out
 * entirely, the answer is treated as passed rather than blocking on a
 * verification step that couldn't run.
 *
 * @param {string} question
 * @param {string} answer
 * @param {Array<{filename: string, section?: string, fullText: string}>} sources
 * @param {{isBroad?: boolean}} [options] - isBroad relaxes the check for
 *   broad/multi-part questions (see buildVerifyPrompt) - these answers
 *   necessarily synthesize across many sources in reworded language, which
 *   a strict per-claim check is more likely to false-positive on than it
 *   would for a narrow, single-fact answer.
 * @returns {Promise<{passed: boolean, issue: string|null}>}
 */
async function verifyAnswer(question, answer, sources, options = {}) {
  if (!sources || sources.length === 0) {
    // Nothing to verify against (e.g. the "not enough info" canned answer) -
    // trivially passes, there's no claim to fact-check.
    return { passed: true, issue: null };
  }

  try {
    const client = getClient();
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: buildVerifyPrompt(question, answer, sources, options) }],
        temperature: 0,
        max_completion_tokens: 200,
      })
    );
    return parseVerifyResponse(response.choices?.[0]?.message?.content);
  } catch (err) {
    const { message } = parseGroqError(err);
    console.warn('[selfVerification] verification call failed, treating as passed:', message);
    return { passed: true, issue: null };
  }
}

module.exports = { verifyAnswer, buildVerifyPrompt, parseVerifyResponse, MODEL };
