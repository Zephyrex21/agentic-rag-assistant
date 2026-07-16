/**
 * Gemini's newer models ("thinking" models: gemini-2.5+, all of gemini-3.x)
 * spend tokens on invisible internal reasoning BEFORE writing the visible
 * response - and those thinking tokens count against the SAME maxOutputTokens
 * budget as the answer itself. Left unconfigured, thinking can consume the
 * entire budget, producing empty or mid-sentence-truncated responses (the
 * exact bug this fixes) - and adds real latency, since generating invisible
 * reasoning tokens still takes time even though you never see them.
 *
 * None of our four call sites (query rewriting, reranking, answer generation
 * from already-retrieved sources, embeddings) benefit meaningfully from deep
 * multi-step reasoning - they're mechanical/grounded tasks, not open-ended
 * problem solving. So we deliberately minimize thinking everywhere.
 *
 * The two model families use INCOMPATIBLE config fields for this:
 *   - gemini-2.5.x: `thinkingConfig.thinkingBudget` (integer, 0 = fully off)
 *   - gemini-3.x:   `thinkingConfig.thinkingLevel` (enum, can't fully disable -
 *                    MINIMAL is the lowest available, still uses some tokens)
 * Using the wrong field for a model family is silently ignored by the API,
 * so this has to branch on the actual model name being called - which
 * matters because withModelFallback can call either the primary or the
 * fallback model, and they may be from different families.
 */
function getThinkingConfig(model) {
  if (/gemini-3/.test(model)) {
    return { thinkingLevel: 'MINIMAL' };
  }
  if (/gemini-2\.5/.test(model)) {
    return { thinkingBudget: 0 };
  }
  // Unknown/future model family - don't guess, let the API default apply
  // rather than silently passing a field it might reject.
  return undefined;
}

/**
 * Gemini 3.x models can't fully disable thinking even at MINIMAL level, so
 * maxOutputTokens needs headroom above what the visible answer actually
 * requires, or a well-formed answer can still get cut off by leftover
 * thinking overhead. This adds a flat buffer for gemini-3.x models only.
 */
function withThinkingHeadroom(model, baseMaxOutputTokens) {
  // 768, not a smaller number: reports indicate even thinkingLevel=MINIMAL on
  // gemini-3.x can still consume several hundred tokens of invisible
  // reasoning before producing visible output. Erring generous here costs
  // nothing extra in practice (the model stops as soon as it's done - this
  // is a ceiling, not a target) but under-provisioning is exactly what
  // caused the original truncation bug.
  const headroom = /gemini-3/.test(model) ? 768 : 0;
  return baseMaxOutputTokens + headroom;
}

/**
 * Gemini's own migration guidance for 3.x models: don't set temperature/
 * top_p/top_k - "Gemini 3's reasoning capabilities are optimized for the
 * default settings." This wasn't a recommendation for gemini-2.5.x, so it's
 * also model-family-conditional, same as thinking config above.
 */
function shouldOmitSamplingParams(model) {
  return /gemini-3/.test(model);
}

/**
 * Builds the full generateContent config for a given model + call site,
 * consolidating all the per-model-family conditionals (thinking, sampling
 * params, token headroom) in one place so the three call sites (generation,
 * rewrite, rerank) can't drift out of sync with each other.
 *
 * @param {string} model
 * @param {object} opts
 * @param {number} [opts.temperature] - omitted entirely for gemini-3.x per Google's guidance
 * @param {number} opts.maxOutputTokens - the baseline for the VISIBLE answer;
 *   headroom for thinking overhead is added automatically where needed
 */
function buildGenerationConfig(model, { temperature, maxOutputTokens }) {
  const config = {
    maxOutputTokens: withThinkingHeadroom(model, maxOutputTokens),
  };

  if (!shouldOmitSamplingParams(model) && temperature !== undefined) {
    config.temperature = temperature;
  }

  const thinkingConfig = getThinkingConfig(model);
  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
  }

  return config;
}

module.exports = { getThinkingConfig, withThinkingHeadroom, shouldOmitSamplingParams, buildGenerationConfig };
