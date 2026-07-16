/**
 * Standalone test for reranker.js's response parsing - no API key needed.
 * Run with: npm run test:reranker
 */
const { parseRerankResponse, buildRerankPrompt } = require('../services/reranker');

const candidates = [
  { id: 'a', filename: 'doc.md', section: 'Intro', text: 'Rate limiting prevents abuse.' },
  { id: 'b', filename: 'doc.md', section: 'Setup', text: 'Install with npm install.' },
  { id: 'c', filename: 'doc.md', section: 'Security', text: 'CORS is configured for safety.' },
];

console.log('=== Reranker Parsing Test ===\n');

const cases = [
  { label: 'Clean JSON array', raw: '[1, 3]', expectIds: ['a', 'c'] },
  { label: 'JSON with surrounding text (model added preamble anyway)', raw: 'Here you go: [3, 1]', expectIds: ['c', 'a'] },
  { label: 'Empty array (nothing relevant)', raw: '[]', expectIds: [] },
  { label: 'Malformed - no array at all', raw: 'sorry, I cannot help with that', expectIds: ['a', 'b', 'c'] }, // falls back to unranked top-K
  { label: 'Out-of-range index (should be filtered, not crash)', raw: '[1, 99, 2]', expectIds: ['a', 'b'] },
  { label: 'Null/undefined input', raw: undefined, expectIds: ['a', 'b', 'c'] },
];

let allPassed = true;
for (const { label, raw, expectIds } of cases) {
  const result = parseRerankResponse(raw, candidates, 5);
  const resultIds = result.map((r) => r.id);
  const passed = JSON.stringify(resultIds) === JSON.stringify(expectIds);
  allPassed = allPassed && passed;
  console.log(`${passed ? '✅' : '❌'} ${label}`);
  console.log(`   raw: ${JSON.stringify(raw)} -> got: [${resultIds}] | expected: [${expectIds}]\n`);
}

// Sanity check the prompt builder doesn't crash and includes the essentials
const prompt = buildRerankPrompt('What is rate limiting?', candidates);
console.assert(prompt.includes('[1]') && prompt.includes('[3]'), 'FAIL: prompt should number all candidates');
console.assert(prompt.includes('JSON array'), 'FAIL: prompt should ask for JSON array output');
console.log(prompt.includes('[1]') && prompt.includes('JSON array') ? '✅ Prompt builder includes numbered candidates + JSON instruction' : '❌ FAILED');

// Regression check for the "what is this document about?" bug - broad/overview
// questions were getting rejected wholesale by an overly strict reranker.
// This locks in that the prompt explicitly instructs otherwise going forward.
const broadQuestionGuidance = prompt.includes('Broad or overview-style questions') && prompt.includes('what is this about');
console.assert(broadQuestionGuidance, 'FAIL: prompt should explicitly guide broad/overview-style questions');
console.log(broadQuestionGuidance ? '✅ Prompt explicitly handles broad/overview-style questions (regression guard)' : '❌ FAILED');

if (allPassed) {
  console.log('\n✅ All reranker parsing tests passed.');
} else {
  console.error('\n❌ Some reranker parsing tests FAILED - see above.');
  process.exit(1);
}
