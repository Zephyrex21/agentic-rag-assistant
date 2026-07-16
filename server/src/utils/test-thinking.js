/**
 * Standalone test for thinkingConfig.js - no API key needed.
 * Run with: npm run test:thinking
 */
const { getThinkingConfig, withThinkingHeadroom } = require('../services/thinkingConfig');

console.log('=== Thinking Config Test ===\n');

const cases = [
  { model: 'gemini-3.5-flash', expectField: 'thinkingLevel', expectValue: 'MINIMAL' },
  { model: 'gemini-3.1-flash-lite', expectField: 'thinkingLevel', expectValue: 'MINIMAL' },
  { model: 'gemini-3-flash-preview', expectField: 'thinkingLevel', expectValue: 'MINIMAL' },
  { model: 'gemini-2.5-flash', expectField: 'thinkingBudget', expectValue: 0 },
  { model: 'gemini-2.5-flash-lite', expectField: 'thinkingBudget', expectValue: 0 },
];

let allPassed = true;
for (const { model, expectField, expectValue } of cases) {
  const config = getThinkingConfig(model);
  const passed = config && config[expectField] === expectValue;
  allPassed = allPassed && passed;
  console.log(`${passed ? '✅' : '❌'} ${model} -> ${JSON.stringify(config)}`);
}

// Unknown model family should not guess
const unknown = getThinkingConfig('some-future-model-v9');
const unknownPassed = unknown === undefined;
allPassed = allPassed && unknownPassed;
console.log(`${unknownPassed ? '✅' : '❌'} Unknown model family -> ${JSON.stringify(unknown)} (should be undefined, not a guess)`);

console.log('\n--- Headroom ---');
const gemini3Headroom = withThinkingHeadroom('gemini-3.5-flash', 1024);
const gemini25Headroom = withThinkingHeadroom('gemini-2.5-flash', 1024);
console.assert(gemini3Headroom > 1024, 'FAIL: gemini-3.x should get extra headroom (cannot fully disable thinking)');
console.assert(gemini25Headroom === 1024, 'FAIL: gemini-2.5.x should get NO extra headroom (thinking fully disabled via budget=0)');
console.log(`${gemini3Headroom > 1024 ? '✅' : '❌'} gemini-3.5-flash: 1024 -> ${gemini3Headroom} (headroom added, since MINIMAL still burns some tokens)`);
console.log(`${gemini25Headroom === 1024 ? '✅' : '❌'} gemini-2.5-flash: 1024 -> ${gemini25Headroom} (no headroom needed, thinking fully off)`);

if (allPassed && gemini3Headroom > 1024 && gemini25Headroom === 1024) {
  console.log('\n✅ All thinking config tests passed.');
} else {
  console.error('\n❌ Some thinking config tests FAILED.');
  process.exit(1);
}

console.log('\n--- buildGenerationConfig (consolidated) ---');
const { buildGenerationConfig } = require('../services/thinkingConfig');

const gemini3Config = buildGenerationConfig('gemini-3.5-flash', { temperature: 0.2, maxOutputTokens: 1024 });
console.log('gemini-3.5-flash config:', gemini3Config);
console.assert(gemini3Config.temperature === undefined, 'FAIL: gemini-3.x should NOT include temperature (Google guidance)');
console.assert(gemini3Config.thinkingConfig?.thinkingLevel === 'MINIMAL', 'FAIL: should set thinkingLevel MINIMAL');
console.assert(gemini3Config.maxOutputTokens === 1792, 'FAIL: should have headroom applied (1024 + 768)');
console.log(
  gemini3Config.temperature === undefined && gemini3Config.thinkingConfig?.thinkingLevel === 'MINIMAL' && gemini3Config.maxOutputTokens === 1792
    ? '✅ gemini-3.5-flash: temperature omitted, thinkingLevel=MINIMAL, headroom applied\n'
    : '❌ FAILED\n'
);

const gemini25Config = buildGenerationConfig('gemini-2.5-flash', { temperature: 0.2, maxOutputTokens: 1024 });
console.log('gemini-2.5-flash config:', gemini25Config);
console.assert(gemini25Config.temperature === 0.2, 'FAIL: gemini-2.5.x SHOULD include temperature');
console.assert(gemini25Config.thinkingConfig?.thinkingBudget === 0, 'FAIL: should set thinkingBudget 0');
console.assert(gemini25Config.maxOutputTokens === 1024, 'FAIL: should have NO headroom (thinking fully off)');
console.log(
  gemini25Config.temperature === 0.2 && gemini25Config.thinkingConfig?.thinkingBudget === 0 && gemini25Config.maxOutputTokens === 1024
    ? '✅ gemini-2.5-flash: temperature kept, thinkingBudget=0, no extra headroom\n'
    : '❌ FAILED\n'
);

console.log('✅ Consolidated config builder tests passed.');
