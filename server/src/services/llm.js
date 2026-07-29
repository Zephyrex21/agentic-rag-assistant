const { getClient } = require('./geminiClient');
const { withModelFallback, parseGeminiError } = require('./modelFallback');
const { buildGenerationConfig } = require('./thinkingConfig');

// gemini-3.5-flash: stable GA model, free tier eligible, no shutdown date
// announced as of this writing. Previously defaulted to gemini-2.5-flash,
// which Google began cutting off for many developers ahead of its own
// announced shutdown date - see modelFallback.js for how we now handle
// this class of problem automatically instead of needing a manual fix
// every time Google rotates the model lineup.
const MODEL = process.env.GENERATION_MODEL || 'gemini-3.5-flash';
// Deliberately NOT gemini-2.5-flash - that's the model that just got cut off.
// gemini-2.5-flash-lite was also reportedly affected by the same rollout, so
// the fallback avoids the whole 2.5 line entirely and cross-pairs with a
// SECOND independent stable model instead (see queryRewriter.js/reranker.js
// for the reverse pairing).
const FALLBACK_MODEL = process.env.GENERATION_MODEL_FALLBACK || 'gemini-3.1-flash-lite';

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
  const ai = getClient('generation');
  const prompt = buildPrompt(question, chunks, history, revision);

  const response = await withModelFallback(MODEL, FALLBACK_MODEL, (model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: buildGenerationConfig(model, {
        temperature: 0.2, // low temperature - we want grounded, consistent answers, not creative ones (ignored for gemini-3.x per Google's guidance)
        maxOutputTokens: 1024,
      }),
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error('Model returned an empty response.');
  }
  return text.trim();
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
  const ai = getClient('generation');
  const prompt = buildPrompt(question, chunks, history, revision);

  const modelsToTry = [MODEL, FALLBACK_MODEL].filter((m, i, arr) => m && arr.indexOf(m) === i);
  let lastError = null;

  for (const model of modelsToTry) {
    // Declared outside the try block so the catch handler below can still
    // see whether any text was already sent to the client for this model.
    let yieldedAnything = false;
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents: prompt,
        config: buildGenerationConfig(model, { temperature: 0.2, maxOutputTokens: 1024 }),
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          yieldedAnything = true;
          yield chunk.text;
        }
      }

      if (!yieldedAnything) {
        throw new Error('Model returned an empty streamed response.');
      }
      return; // success - don't fall through to trying the next model
    } catch (err) {
      lastError = err;
      const { message } = parseGeminiError(err);

      // If we already streamed some text to the client for this model, we
      // can't cleanly retry with a fallback - the client would see a
      // confusing partial-then-restarted answer. Let the error propagate
      // instead of silently continuing to the next model in the loop.
      if (yieldedAnything) {
        console.warn(`[llm] streaming with "${model}" failed mid-stream after chunks were already sent - not retrying: ${message}`);
        throw new Error(message);
      }

      console.warn(`[llm] streaming with "${model}" failed, ${model === modelsToTry[modelsToTry.length - 1] ? 'no more fallbacks' : 'trying fallback'}: ${message}`);
    }
  }

  const { message } = parseGeminiError(lastError);
  throw new Error(message);
}

module.exports = { generateAnswer, generateAnswerStream, buildPrompt, MODEL };
