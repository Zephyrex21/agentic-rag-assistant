/**
 * Gemini's SDK sometimes throws with `.message` set to the RAW JSON error
 * body from the API (e.g. `{"error":{"code":404,"message":"...","status":"NOT_FOUND"}}`)
 * instead of a clean string. Left unhandled, that raw JSON ends up rendered
 * directly in the UI - not helpful for anyone. This extracts the actual
 * human-readable message underneath.
 */
function parseGeminiError(err) {
  const raw = err?.message || String(err);
  const jsonMatch = raw.match(/\{.*\}/s);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error?.message) {
        return { message: parsed.error.message, code: parsed.error.code, status: parsed.error.status };
      }
    } catch {
      // wasn't actually JSON, fall through to returning the raw message
    }
  }
  return { message: raw, code: null, status: null };
}

/**
 * True for errors that mean "this specific model is gone/unavailable" as
 * opposed to a transient issue (rate limit, network blip) - only THIS
 * category should trigger a fallback-model retry. Google has deprecated
 * models earlier than their own announced shutdown dates more than once,
 * so this check matters in practice, not just in theory.
 */
function isModelUnavailableError(err) {
  const { message, code, status } = parseGeminiError(err);
  if (code === 404 || status === 'NOT_FOUND') return true;
  return /no longer available|not found|model.*not.*exist/i.test(message);
}

/**
 * Runs an API call against a primary model, automatically retrying once
 * against a fallback model if the primary is unavailable (deprecated/
 * shut down). Both model names come from .env, so you can update either
 * without touching code the next time Google rotates something.
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
        const { message } = parseGeminiError(fallbackErr);
        throw new Error(`Both "${primaryModel}" and fallback "${fallbackModel}" failed: ${message}`);
      }
    }
    const { message } = parseGeminiError(err);
    throw new Error(message);
  }
}

// Models Google has cut off early/unreliably in the past, ahead of their
// own announced shutdown dates. If a person's .env still explicitly pins
// one of these (e.g. carried over from before this fix), warn loudly at
// boot instead of waiting for the first failed request to surface it.
const KNOWN_PROBLEMATIC_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

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
      console.warn(`   ${envVar}=${model} - this model has had reliability issues (Google cut it off early for many users).`);
    });
    console.warn('   Consider updating your .env to gemini-3.5-flash / gemini-3.1-flash-lite instead.\n');
  }
}

module.exports = { parseGeminiError, isModelUnavailableError, withModelFallback, checkForProblematicModels, KNOWN_PROBLEMATIC_MODELS };
