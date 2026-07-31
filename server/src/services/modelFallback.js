/**
 * Groq's SDK throws a typed APIError with a clean `.status` (HTTP code)
 * and `.error` (the parsed JSON error body) - much cleaner than having to
 * regex a JSON blob out of `.message` (which Gemini's SDK sometimes made
 * necessary). This still defensively handles a couple of possible shapes
 * for `.error` since the SDK types it loosely as `Object | undefined`.
 */
function parseGroqError(err) {
  const status = err?.status ?? null;
  const body = err?.error?.error ?? err?.error ?? null; // handle either nesting
  const code = body?.code ?? null;
  const message = body?.message ?? err?.message ?? String(err);
  return { message, code, status };
}

/**
 * True for errors that mean "this specific model is gone" (decommissioned/
 * deprecated) as opposed to a transient issue (rate limit, network blip) -
 * only THIS category should trigger a fallback-model retry. Groq returns
 * HTTP 400 with code "model_decommissioned" for this (not 404 - a common
 * assumption to get wrong if you're used to other providers).
 */
function isModelUnavailableError(err) {
  const { message, code } = parseGroqError(err);
  if (code === 'model_decommissioned' || code === 'model_not_found') return true;
  return /decommissioned|no longer supported|does not exist/i.test(message || '');
}

/**
 * Runs an API call against a primary model, automatically retrying once
 * against a fallback model if the primary is unavailable (deprecated/
 * decommissioned). Both model names come from .env, so you can update
 * either without touching code the next time Groq retires something.
 *
 * @param {string} primaryModel
 * @param {string|undefined} fallbackModel
 * @param {(model: string) => Promise<any>} callFn
 */
async function withModelFallback(primaryModel, fallbackModel, callFn) {
  try {
    return await callFn(primaryModel);
  } catch (err) {
    if (fallbackModel && fallbackModel !== primaryModel && isModelUnavailableError(err)) {
      console.warn(
        `[modelFallback] "${primaryModel}" is unavailable, retrying with fallback "${fallbackModel}". ` +
          `Consider updating your .env default once you see this.`
      );
      try {
        return await callFn(fallbackModel);
      } catch (fallbackErr) {
        const { message } = parseGroqError(fallbackErr);
        throw new Error(`Both "${primaryModel}" and fallback "${fallbackModel}" failed: ${message}`);
      }
    }
    const { message } = parseGroqError(err);
    throw new Error(message);
  }
}

// Models Groq has decommissioned as of the most recent deprecation notices
// (console.groq.com/docs/deprecations). If a person's .env still explicitly
// pins one of these, warn loudly at boot instead of waiting for the first
// failed request to surface it.
const KNOWN_PROBLEMATIC_MODELS = [
  'llama3-70b-8192',
  'llama-3.1-70b-versatile',
  'llama-3.3-70b-specdec',
  'deepseek-r1-distill-llama-70b',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-1b-preview',
  'llama-guard-3-8b',
  'gemma2-9b-it',
  'gemma-7b-it',
  'mixtral-8x7b-32768',
  'mistral-saba-24b',
  'qwen-qwq-32b',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-guard-4-12b',
  'moonshotai/kimi-k2-instruct-0905',
  'distil-whisper-large-v3-en',
  'playai-tts',
];

/**
 * Checks a set of {envVarName: modelValue} pairs at startup and logs a
 * clear warning for any that match a known-problematic model. Call this
 * once from app.js on boot.
 */
function checkForProblematicModels(configuredModels) {
  const problems = Object.entries(configuredModels).filter(
    ([, model]) => model && KNOWN_PROBLEMATIC_MODELS.includes(model)
  );
  if (problems.length > 0) {
    console.warn('\n⚠️  Model configuration warning:');
    problems.forEach(([envVar, model]) => {
      console.warn(`   ${envVar}=${model} - this model has been decommissioned by Groq.`);
    });
    console.warn('   Check https://console.groq.com/docs/models for current recommendations.\n');
  }
}

/**
 * Provider-level fallback - distinct from withModelFallback above, and
 * deliberately opposite in one respect: withModelFallback intentionally
 * does NOT retry on transient errors (rate limits, network blips), only on
 * confirmed model-unavailable errors. This function exists specifically
 * to catch those transient/outage cases at the PROVIDER level - if Groq
 * itself is having a bad day, retry the whole request against Cerebras
 * rather than failing outright. This is what stops a single provider
 * outage from taking the whole app down (the exact failure mode this
 * project has already been burned by once).
 *
 * @param {() => Promise<any>} primaryFn - the Groq call
 * @param {(() => Promise<any>)|null} fallbackFn - the Cerebras call, or
 *   null if no fallback is configured (e.g. CEREBRAS_API_KEY unset)
 * @param {string} fallbackLabel - for logging
 */
async function withProviderFallback(primaryFn, fallbackFn, fallbackLabel = 'fallback provider') {
  try {
    return await primaryFn();
  } catch (primaryErr) {
    if (!fallbackFn) throw primaryErr;
    console.warn(`[providerFallback] Groq call failed entirely, retrying via ${fallbackLabel}: ${primaryErr.message}`);
    try {
      return await fallbackFn();
    } catch (fallbackErr) {
      throw new Error(`Both Groq and ${fallbackLabel} failed. Groq: ${primaryErr.message} | ${fallbackLabel}: ${fallbackErr.message}`);
    }
  }
}

module.exports = { parseGroqError, isModelUnavailableError, withModelFallback, withProviderFallback, checkForProblematicModels, KNOWN_PROBLEMATIC_MODELS };
