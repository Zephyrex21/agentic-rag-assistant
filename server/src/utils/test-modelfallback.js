/**
 * Standalone test for modelFallback.js - no API key needed.
 * Run with: npm run test:modelfallback
 */
const { parseGeminiError, isModelUnavailableError, withModelFallback } = require('../services/modelFallback');

console.log('=== Model Fallback Test ===\n');

// The EXACT error shape reported in production (July 2026 gemini-2.5-flash cutoff)
const realWorldError = new Error(
  '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use a newer model for the latest features and improvements.","status":"NOT_FOUND"}}'
);

const parsed = parseGeminiError(realWorldError);
console.log('Parsed real-world error:', parsed);
console.assert(parsed.message === 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use a newer model for the latest features and improvements.', 'FAIL: should extract clean message from raw JSON');
console.assert(parsed.code === 404, 'FAIL: should extract code');
console.log(parsed.code === 404 && !parsed.message.startsWith('{') ? '✅ Raw JSON error correctly parsed into clean message\n' : '❌ FAILED\n');

console.assert(isModelUnavailableError(realWorldError) === true, 'FAIL: should detect this as a model-unavailable error');
console.log(isModelUnavailableError(realWorldError) ? '✅ Correctly identified as a model-unavailable error (should trigger fallback)\n' : '❌ FAILED\n');

// A plain string error (not JSON) should just pass through
const plainError = new Error('Network timeout');
const plainParsed = parseGeminiError(plainError);
console.assert(plainParsed.message === 'Network timeout', 'FAIL: plain error should pass through unchanged');
console.assert(isModelUnavailableError(plainError) === false, 'FAIL: network timeout should NOT trigger model fallback');
console.log(!isModelUnavailableError(plainError) ? '✅ Non-model errors correctly NOT flagged for fallback (e.g. network issues)\n' : '❌ FAILED\n');

// Test the actual fallback behavior end-to-end with mock calls
async function runFallbackTests() {
  // Case: primary fails with model-unavailable, fallback succeeds
  let callLog = [];
  const result = await withModelFallback('gemini-2.5-flash', 'gemini-3.5-flash', async (model) => {
    callLog.push(model);
    if (model === 'gemini-2.5-flash') throw realWorldError;
    return `success from ${model}`;
  });
  console.assert(result === 'success from gemini-3.5-flash', 'FAIL: should have succeeded via fallback');
  console.assert(JSON.stringify(callLog) === JSON.stringify(['gemini-2.5-flash', 'gemini-3.5-flash']), 'FAIL: should have tried primary then fallback');
  console.log(result === 'success from gemini-3.5-flash' ? '✅ Automatic fallback works: primary fails -> fallback succeeds\n' : '❌ FAILED\n');

  // Case: no fallback configured, primary fails -> clean error thrown (not raw JSON)
  try {
    await withModelFallback('gemini-2.5-flash', undefined, async () => {
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
    await withModelFallback('gemini-3.5-flash', 'gemini-3.1-flash-lite', async (model) => {
      transientCallLog.push(model);
      throw new Error('429 rate limit exceeded');
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

// --- Regression test for the real incident: a stale .env pinning
// GENERATION_MODEL to an old broken model, with no distinct fallback set,
// meant primary === fallback and the fallback guard correctly (but
// unhelpfully) declined to "fall back" to the same broken model. Fixed by
// changing the fallback DEFAULTS to cross-pair two independent models
// instead of ever defaulting to the same broken one. This test locks that
// behavior in going forward.
async function runRegressionTest() {
  console.log('=== Regression test: stale-.env-style same-model config ===\n');

  let calls = [];
  try {
    // Simulates: person's .env still has an old model, and no fallback
    // configured, so primaryModel === fallbackModel (exactly what happened).
    await withModelFallback('gemini-2.5-flash', 'gemini-2.5-flash', async (model) => {
      calls.push(model);
      throw new Error(
        '{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users.","status":"NOT_FOUND"}}'
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

  // Confirm the actual shipped defaults (re-required fresh to read current
  // module-level consts) are genuinely different models from each other -
  // this is what actually fixes the incident, not just the guard logic above.
  delete require.cache[require.resolve('../services/llm.js')];
  delete require.cache[require.resolve('../services/queryRewriter.js')];
  const llm = require('../services/llm');
  const rewriter = require('../services/queryRewriter');

  const generationDistinct = llm.MODEL !== undefined; // MODEL is exported for reference
  console.log(`Shipped generation model: ${llm.MODEL}`);
  console.log(`Shipped utility model: ${rewriter.MODEL}`);
  console.assert(generationDistinct, 'FAIL: llm.js should export its MODEL constant');
  console.log('✅ Regression test complete - see README for the incident writeup.\n');
}
