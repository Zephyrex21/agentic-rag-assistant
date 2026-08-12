/**
 * Standalone test for agenticRag.js's pure helpers (system prompt building,
 * tool argument parsing) - no API key needed. The actual planning LOOP
 * makes real tool-calling API calls and isn't covered here, the same way
 * reranker.js's rerank()/queryRewriter.js's rewriteQuery() aren't - only
 * their pure prompt-building/response-parsing pieces are (see
 * test-reranker.js). Live behavior of the loop itself is exercised via
 * the eval harness and manual testing against a real Groq key.
 * Run with: npm run test:agenticplanner
 */
const { buildPlannerSystemPrompt, parseToolArgs, MAX_STEPS } = require('../services/agenticRag');

console.log('=== Agentic Planner Test ===\n');

// --- buildPlannerSystemPrompt ---

const prompt3 = buildPlannerSystemPrompt(3);
console.assert(prompt3.includes('3 tool calls'), 'FAIL: prompt should mention the step limit passed in');
console.assert(/search_documents/.test(prompt3), 'FAIL: prompt should reference search_documents by name');
console.assert(/list_documents/.test(prompt3), 'FAIL: prompt should reference list_documents by name');
console.assert(
  /never skip searching because you think you already know the answer/i.test(prompt3),
  'FAIL: the core groundedness safety rule is missing from the prompt'
);
console.log('✅ System prompt includes the step limit, both tool names, and the core groundedness rule');

const prompt1 = buildPlannerSystemPrompt(1);
console.assert(prompt1.includes('1 tool calls'), 'FAIL: step limit should vary with the maxSteps argument');
console.log('✅ Step limit is parameterized, not hardcoded');

console.assert(typeof MAX_STEPS === 'number' && MAX_STEPS > 0, 'FAIL: MAX_STEPS should be a positive number by default');
console.log(`✅ Default MAX_STEPS is a sane positive number (${MAX_STEPS})`);

// --- parseToolArgs ---

console.assert(
  JSON.stringify(parseToolArgs('{"query": "what is Cryptex"}')) === JSON.stringify({ query: 'what is Cryptex' }),
  'FAIL: well-formed JSON args should parse through unchanged'
);
console.log('✅ Well-formed tool arguments parsed correctly');

console.assert(JSON.stringify(parseToolArgs(undefined)) === '{}', 'FAIL: missing arguments should default to {}');
console.assert(JSON.stringify(parseToolArgs('')) === '{}', 'FAIL: empty string arguments should default to {}');
console.log('✅ Missing/empty arguments default to {} rather than throwing');

console.assert(JSON.stringify(parseToolArgs('{not valid json')) === '{}', 'FAIL: malformed JSON should fail soft to {}');
console.log('✅ Malformed JSON arguments fail soft to {} rather than throwing');

console.assert(JSON.stringify(parseToolArgs('"just a string"')) === '{}', 'FAIL: valid JSON that is not an object should fail soft to {}');
console.assert(JSON.stringify(parseToolArgs('42')) === '{}', 'FAIL: valid JSON number should fail soft to {}');
console.assert(JSON.stringify(parseToolArgs('null')) === '{}', 'FAIL: JSON null should fail soft to {}, not stay null');
console.log('✅ Non-object JSON (string/number/null) fails soft to {} rather than being returned as-is');

console.log('\n✅ All agentic planner pure-function tests passed.');
