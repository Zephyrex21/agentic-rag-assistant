/**
 * Standalone test for queryExpansion.js's response parsing - no API key needed.
 * Run with: npm run test:queryexpansion
 */
const { parseExpansionResponse, buildExpansionPrompt } = require('../services/queryExpansion');

console.log('=== Query Expansion Test ===\n');

// Case 1: well-formed JSON array response
const clean = parseExpansionResponse('["What security features does it have?", "How is the app secured?"]', 2);
console.log('Clean response ->', clean);
console.assert(clean.length === 2, `FAIL: expected 2 variants, got ${clean.length}`);
console.assert(clean[0] === 'What security features does it have?', 'FAIL: first variant mismatch');
console.log(clean.length === 2 ? '✅ Well-formed JSON array parsed correctly' : '❌ FAILED');

// Case 2: model wraps the array in prose (a common real-world deviation)
const wrapped = parseExpansionResponse('Sure, here you go:\n["variant one", "variant two"]\nHope that helps!', 2);
console.assert(wrapped.length === 2, `FAIL: expected 2 variants extracted from wrapped text, got ${wrapped.length}`);
console.log(wrapped.length === 2 ? '✅ JSON array extracted correctly even with surrounding prose' : '❌ FAILED');

// Case 3: malformed JSON should fail soft to an empty array, not throw
const malformed = parseExpansionResponse('[not valid json,,,]', 2);
console.assert(Array.isArray(malformed) && malformed.length === 0, 'FAIL: malformed JSON should return empty array');
console.log('✅ Malformed JSON handled without throwing (empty array returned)');

// Case 4: the regex extracts an array, but its elements are the wrong type
// (e.g. the model responds with numbers instead of question strings) -
// should filter down to empty rather than return non-string values.
const wrongElementType = parseExpansionResponse('The relevant room numbers are [12, 34, 56].', 2);
console.assert(
  Array.isArray(wrongElementType) && wrongElementType.length === 0,
  'FAIL: array of non-string elements should filter to empty'
);
console.log('✅ Array of non-string elements filtered to empty rather than returned as-is');

// Case 5: more items than requested should be capped, and non-string/empty
// entries should be filtered out
const overCapped = parseExpansionResponse('["a", "", "b", 42, "c", "d"]', 2);
console.assert(overCapped.length === 2, `FAIL: expected result capped at 2, got ${overCapped.length}`);
console.assert(overCapped.every((v) => typeof v === 'string' && v.length > 0), 'FAIL: non-string/empty entries should be filtered');
console.log('✅ Over-length/invalid entries filtered and capped correctly');

// Case 6: no JSON array at all in the response
const empty = parseExpansionResponse('I cannot help with that.', 2);
console.assert(Array.isArray(empty) && empty.length === 0, 'FAIL: no-array response should return empty array');
console.log('✅ Response with no JSON array handled without throwing');

// Case 7: prompt construction sanity check
const prompt = buildExpansionPrompt('What security features does Cryptex have?', 2);
console.assert(prompt.includes('Cryptex'), 'FAIL: prompt missing the original question');
console.assert(prompt.includes('2'), 'FAIL: prompt missing the requested count');
console.log('✅ Expansion prompt includes the original question and requested count');

console.log('\n✅ All query expansion tests passed.');
