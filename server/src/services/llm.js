const { getClient } = require('./groqClient');
const { getClient: getCerebrasClient } = require('./cerebrasClient');
const { withModelFallback, withProviderFallback, parseGroqError } = require('./modelFallback');

// llama-3.3-70b-versatile: current production-tier model on Groq, free-tier
// eligible, not on the deprecation list as of the most recent notices (see
// modelFallback.js). Not a reasoning model - kept deliberately, since low
// latency + grounded/concise answers matter more here than deep reasoning,
// and Groq's free-tier rate limits reward staying on faster models.
const MODEL = process.env.GENERATION_MODEL || 'llama-3.3-70b-versatile';
// Cross-family fallback (Llama vs OpenAI's open-weight line) so a single
// vendor-family issue doesn't take down both the primary and the fallback
// at once - same philosophy as the old Gemini setup's cross-pairing.
const FALLBACK_MODEL = process.env.GENERATION_MODEL_FALLBACK || 'openai/gpt-oss-120b';
// A different model family than MODEL (Cerebras's free public catalog is
// deliberately small - gpt-oss-120b is the current production-tier option
// there, see https://inference-docs.cerebras.ai/models/overview), but on
// an entirely different PROVIDER - this is the net that catches Groq
// itself being down/rate-limited, which FALLBACK_MODEL above can't help
// with since it's still a Groq call.
const CEREBRAS_FALLBACK_MODEL = process.env.CEREBRAS_FALLBACK_MODEL || 'gpt-oss-120b';

function buildPrompt(question, chunks, history = [], revision = null) {
  const context = chunks
    .map((c, i) => `[Source ${i + 1}: ${c.filename}${c.section && c.section !== 'N/A' ? ` — ${c.section}` : ''}]\n${c.text}`)
    .join('\n\n---\n\n');

  const historyBlock = history.length
    ? `CONVERSATION SO FAR:\n${history.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}\n\n`
    : '';

  // Revision pass: the first answer didn't hold up to self-verification.
  // Feed the specific critique back in rather than just retrying blind -
  // this is what makes the second attempt more conservative rather than
  // just a coin-flip re-roll of the same mistake.
  const revisionBlock = revision
    ? `Your previous attempt at this answer was: "${revision.previousAnswer}"\n\n` +
      `That attempt had a problem: ${revision.issues}\n\n` +
      `Write a corrected answer that fixes this. Be more conservative - if you're not sure ` +
      `something is directly supported by the sources below, leave it out rather than guess.\n\n`
    : '';

  return `You are a knowledge assistant answering questions using ONLY the source excerpts below. Follow these rules strictly:

1. Answer using only information found in the sources. Do not use outside knowledge.
2. If the sources don't contain enough information to answer, say so clearly instead of guessing.
3. When you use information from a source, mention it inline like "(Source 1)" or "(Source 2)" so the person can trace where each part of the answer came from.
4. Be concise and direct. Do not pad the answer with filler.
5. If the conversation so far gives context for this question (e.g. "it", "that", "the second one"), use it to understand what's being asked - but still answer only from the sources below.

${historyBlock}${revisionBlock}SOURCES:
${context}

QUESTION: ${question}

ANSWER:`;
}

/**
 * Generates a grounded answer from retrieved chunks.
 * @param {string} question
 * @param {Array<{filename: string, section: string, text: string}>} chunks
 * @returns {Promise<string>}
 */
async function generateAnswer(question, chunks, history = [], revision = null) {
  const prompt = buildPrompt(question, chunks, history, revision);

  const callGroq = async () => {
    const client = getClient();
    const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
      client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, // low temperature - we want grounded, consistent answers, not creative ones
        max_completion_tokens: 1024,
      })
    );
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new Error('Model returned an empty response.');
    return text.trim();
  };

  const cerebras = getCerebrasClient();
  const callCerebras = cerebras
    ? async () => {
        const response = await cerebras.chat.completions.create({
          model: CEREBRAS_FALLBACK_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
          max_tokens: 1024,
        });
        const text = response.choices?.[0]?.message?.content;
        if (!text) throw new Error('Cerebras returned an empty response.');
        return text.trim();
      }
    : null;

  return withProviderFallback(callGroq, callCerebras, 'Cerebras');
}

/**
 * Streaming variant - yields text chunks as they're generated instead of
 * waiting for the full answer. Fallback works differently here than the
 * promise-based withModelFallback: we need the FIRST chunk to arrive
 * successfully before committing to a model, since a stream that fails
 * mid-way (after some chunks already reached the client) can't be cleanly
 * retried without showing a confusing partial-then-restarted answer.
 *
 * @param {string} question
 * @param {Array<{filename: string, section: string, text: string}>} chunks
 * @param {Array<{role: string, content: string}>} history
 * @yields {string} text chunks as they arrive
 */
async function* generateAnswerStream(question, chunks, history = [], revision = null) {
  const client = getClient();
  const prompt = buildPrompt(question, chunks, history, revision);
  const messages = [{ role: 'user', content: prompt }];

  // Ordered list of attempts: primary model, cross-family model fallback
  // (both Groq), then Cerebras as the last resort if Groq itself is down -
  // same one-list-of-attempts shape as the non-streaming version above,
  // just adapted for the generator/yield style streaming needs.
  const attempts = [MODEL, FALLBACK_MODEL]
    .filter((m, i, arr) => m && arr.indexOf(m) === i)
    .map((model) => ({
      label: model,
      createStream: () =>
        client.chat.completions.create({
          model,
          messages,
          temperature: 0.2,
          max_completion_tokens: 1024,
          stream: true,
        }),
    }));

  const cerebras = getCerebrasClient();
  if (cerebras) {
    attempts.push({
      label: `Cerebras/${CEREBRAS_FALLBACK_MODEL}`,
      createStream: () =>
        cerebras.chat.completions.create({
          model: CEREBRAS_FALLBACK_MODEL,
          messages,
          temperature: 0.2,
          max_tokens: 1024,
          stream: true,
        }),
    });
  }

  let lastError = null;

  for (const { label, createStream } of attempts) {
    // Declared outside the try block so the catch handler below can still
    // see whether any text was already sent to the client for this attempt.
    let yieldedAnything = false;
    try {
      const stream = await createStream();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          yieldedAnything = true;
          yield delta;
        }
      }

      if (!yieldedAnything) {
        throw new Error(`"${label}" returned an empty streamed response.`);
      }
      return; // success - don't fall through to trying the next attempt
    } catch (err) {
      lastError = err;
      const { message } = parseGroqError(err);

      // If we already streamed some text to the client for this attempt, we
      // can't cleanly retry with a fallback - the client would see a
      // confusing partial-then-restarted answer. Let the error propagate
      // instead of silently continuing to the next attempt in the loop.
      if (yieldedAnything) {
        console.warn(`[llm] streaming with "${label}" failed mid-stream after chunks were already sent - not retrying: ${message}`);
        throw new Error(message);
      }

      console.warn(`[llm] streaming with "${label}" failed, ${label === attempts[attempts.length - 1].label ? 'no more fallbacks' : 'trying next'}: ${message}`);
    }
  }

  const { message } = parseGroqError(lastError);
  throw new Error(message);
}

module.exports = { generateAnswer, generateAnswerStream, buildPrompt, MODEL };
