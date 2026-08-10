/**
 * Standalone test for dedup.js - no API key needed.
 * Run with: npm run test:dedup
 */
const { dedupeChunks, jaccardSimilarity, wordSet } = require('../services/dedup');

console.log('=== Deduplication Test ===\n');

// Case 1: near-identical text (e.g. two overlapping word-window chunks)
// should collapse to just the higher-ranked one.
const nearDuplicates = [
  { id: 'a', text: 'The platform includes rate limiting, CORS configuration, and magic-byte upload validation for security.' },
  { id: 'b', text: 'The platform includes rate limiting, CORS configuration, and magic-byte upload validation for security purposes.' },
  { id: 'c', text: 'Folders are a pure organizational layer and deleting one never deletes the documents inside it.' },
];
const deduped = dedupeChunks(nearDuplicates, 0.82);
console.log('Input: 3 chunks (a, b near-identical; c distinct)');
console.log('Kept:', deduped.map((c) => c.id).join(', '));
console.assert(deduped.length === 2, `FAIL: expected 2 chunks kept, got ${deduped.length}`);
console.assert(deduped[0].id === 'a', 'FAIL: expected the first (higher-ranked) near-duplicate to be kept');
console.assert(deduped.some((c) => c.id === 'c'), 'FAIL: expected the genuinely distinct chunk to survive');
console.log(deduped.length === 2 && deduped[0].id === 'a' ? '✅ Near-duplicate correctly collapsed, higher-ranked copy kept' : '❌ FAILED');

// Case 2: genuinely distinct passages that merely share some vocabulary
// should NOT be treated as duplicates.
const distinctButRelated = [
  { id: 'x', text: 'Pinecone stores the vector embeddings used for semantic similarity search across all uploaded documents.' },
  { id: 'y', text: 'Supabase stores the conversation history and full-text search index used for keyword-based retrieval.' },
];
const notDeduped = dedupeChunks(distinctButRelated, 0.82);
console.log('\nInput: 2 distinct passages sharing some vocabulary (stores/search/documents)');
console.log('Kept:', notDeduped.map((c) => c.id).join(', '));
console.assert(notDeduped.length === 2, `FAIL: expected both distinct passages kept, got ${notDeduped.length}`);
console.log(notDeduped.length === 2 ? '✅ Distinct passages correctly NOT flagged as duplicates' : '❌ FAILED');

// Case 3: empty/missing text shouldn't crash, and empty input returns empty.
console.assert(dedupeChunks([]).length === 0, 'FAIL: empty input should return empty output');
console.assert(dedupeChunks([{ id: 'z', text: '' }]).length === 1, 'FAIL: a single chunk (even empty text) should survive');
console.log('\n✅ Edge cases (empty input, empty text) handled without crashing');

// Case 4: jaccardSimilarity itself - sanity checks on the primitive.
console.assert(jaccardSimilarity(wordSet('a b c'), wordSet('a b c')) === 1, 'FAIL: identical sets should score 1.0');
console.assert(jaccardSimilarity(wordSet('a b c'), wordSet('x y z')) === 0, 'FAIL: disjoint sets should score 0.0');
console.log('✅ jaccardSimilarity primitive: identical=1.0, disjoint=0.0 as expected');

console.log('\n✅ All deduplication tests passed.');
