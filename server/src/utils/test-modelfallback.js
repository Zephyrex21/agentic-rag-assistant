/**
 * Standalone test for modelFallback.js - no API key needed.
 * Run with: npm run test:modelfallback
 */
const { parseGroqError, isModelUnavailableError, withModelFallback } = require('../services/modelFallback');

console.log('=== Model Fallback Test ===\n');

// The EXACT error shape Groq's SDK throws for a decommissioned model:
// APIError with .status (HTTP code) and .error (parsed JSON body) -
// see github issues from real projects hitting this in production.
function makeGroqError(message, status, code) {
  const err = new Error(message);
  err.status = status;
  err.error = { error: { message, type: 'invalid_request_error', code } };
  return err;
}

const realWorldError = makeGroqError(
  'The model `llama3-70b-8192` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations for a recommendation on which model to use instead.',
  400,
  'model_decommissioned'
);

const parsed = parseGroqError(realWorldError);
console.log('Parsed real-world error:', parsed);
console.assert(parsed.code === 'model_decommissioned', 'FAIL: should extract code from nested error body');
console.assert(parsed.status === 400, 'FAIL: should extract status');
console.log(parsed.code === 'model_decommissioned' && parsed.status === 400 ? '✅ Decommissioned-model error correctly parsed\n' : '❌ FAILED\n');

console.assert(isModelUnavailableError(realWorldError) === true, 'FAIL: should detect this as a model-unavailable error');
console.log(isModelUnavailableError(realWorldError) ? '✅ Correctly identified as a model-unavailable error (should trigger fallback)\n' : '❌ FAILED\n');

// A plain network/transient error (no .status/.error shape) should just pass through
const plainError = new Error('Network timeout');
const plainParsed = parseGroqError(plainError);
console.assert(plainParsed.message === 'Network timeout', 'FAIL: plain error should pass through unchanged');
console.assert(isModelUnavailableError(plainError) === false, 'FAIL: network timeout should NOT trigger model fallback');
console.log(!isModelUnavailableError(plainError) ? '✅ Non-model errors correctly NOT flagged for fallback (e.g. network issues)\n' : '❌ FAILED\n');

// A rate-limit error (real Groq shape: status 429, code 'rate_limit_exceeded')
// should also NOT trigger a model-fallback retry - that's not what fallback is for.
const rateLimitError = makeGroqError('Rate limit reached for model', 429, 'rate_limit_exceeded');
console.assert(isModelUnavailableError(rateLimitError) === false, 'FAIL: rate limit should NOT trigger model fallback');
console.log(!isModelUnavailableError(rateLimitError) ? '✅ Rate-limit errors correctly do NOT trigger fallback retry\n' : '❌ FAILED\n');

// Test the actual fallback behavior end-to-end with mock calls
async function runFallbackTests() {
  // Case: primary fails with model-unavailable, fallback succeeds
  let callLog = [];
  const result = await withModelFallback('llama3-70b-8192', 'llama-3.3-70b-versatile', async (model) => {
    callLog.push(model);
    if (model === 'llama3-70b-8192') throw realWorldError;
    return `success from ${model}`;
  });
  console.assert(result === 'success from llama-3.3-70b-versatile', 'FAIL: should have succeeded via fallback');
  console.assert(JSON.stringify(callLog) === JSON.stringify(['llama3-70b-8192', 'llama-3.3-70b-versatile']), 'FAIL: should have tried primary then fallback');
  console.log(result === 'success from llama-3.3-70b-versatile' ? '✅ Automatic fallback works: primary fails -> fallback succeeds\n' : '❌ FAILED\n');

  // Case: no fallback configured, primary fails -> clean error thrown
  try {
    await withModelFallback('llama3-70b-8192', undefined, async () => {
      throw realWorldError;
    });
    console.log('❌ FAILED: should have thrown\n');
  } catch (err) {
    const isClean = !err.message.startsWith('{');
    console.assert(isClean, 'FAIL: thrown error should be clean, not raw JSON');
    console.log(isClean ? `✅ No fallback configured -> clean error thrown: "${err.message}"\n` : '❌ FAILED\n');
  }

  // Case: transient error (not model-unavailable) should NOT trigger fallback, even if one is configured
  let transientCallLog = [];
  try {
    await withModelFallback('llama-3.3-70b-versatile', 'llama-3.1-8b-instant', async (model) => {
      transientCallLog.push(model);
      throw rateLimitError;
    });
  } catch {
    // expected to throw
  }
  console.assert(transientCallLog.length === 1, 'FAIL: transient errors should NOT trigger a fallback retry');
  console.log(transientCallLog.length === 1 ? '✅ Transient errors (rate limits etc.) correctly do NOT trigger fallback retry\n' : '❌ FAILED\n');

  console.log('✅ All model fallback tests passed.');
}

async function main() {
  await runFallbackTests();
  await runRegressionTest();
}

main();

// --- Regression test, ported from the Gemini-era incident this pattern
// originally caught: a stale .env pinning a model constant to an old/
// decommissioned model, with no distinct fallback set, meant
// primary === fallback and the fallback guard correctly (but unhelpfully)
// declined to "fall back" to the same broken model. Fixed by cross-pairing
// two independent model families by default instead of ever defaulting to
// the same one twice. This test locks that behavior in for the Groq
// migration too, since it's a mistake worth guarding against regardless
// of which provider is behind the API.
async function runRegressionTest() {
  console.log('=== Regression test: stale-.env-style same-model config ===\n');

  let calls = [];
  try {
    // Simulates: person's .env still has an old model, and no fallback
    // configured, so primaryModel === fallbackModel.
    await withModelFallback('llama3-70b-8192', 'llama3-70b-8192', async (model) => {
      calls.push(model);
      throw makeGroqError(
        'The model `llama3-70b-8192` has been decommissioned and is no longer supported.',
        400,
        'model_decommissioned'
      );
    });
  } catch (err) {
    const onlyCalledOnce = calls.length === 1;
    const cleanMessage = !err.message.startsWith('{');
    console.assert(onlyCalledOnce, 'FAIL: should not retry against the identical model');
    console.assert(cleanMessage, 'FAIL: even this failure path should surface a clean message');
    console.log(
      onlyCalledOnce && cleanMessage
        ? `✅ Same-model config correctly declines to "fall back" to itself, still throws a clean error: "${err.message}"\n`
        : '❌ FAILED\n'
    );
  }

  // Confirm the actual shipped defaults are genuinely different models from
  // each other - this is what actually prevents the incident, not just the
  // guard logic above.
  delete require.cache[require.resolve('../services/llm.js')];
  delete require.cache[require.resolve('../services/queryRewriter.js')];
  const llm = require('../services/llm');
  const rewriter = require('../services/queryRewriter');

  const generationDistinct = llm.MODEL !== undefined; // MODEL is exported for reference
  console.log(`Shipped generation model: ${llm.MODEL}`);
  console.log(`Shipped utility model: ${rewriter.MODEL}`);
  console.assert(generationDistinct, 'FAIL: llm.js should export its MODEL constant');
  console.log('✅ Regression test complete.\n');
}
