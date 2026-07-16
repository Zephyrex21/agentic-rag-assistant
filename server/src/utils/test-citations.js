/**
 * Standalone test for Phase 4's citation extraction - no API key needed.
 * Run with: npm run test:citations
 */
const { extractCitedSourceNumbers } = require('../services/rag');

const cases = [
  {
    label: 'Basic single citation',
    answer: 'Cryptex uses rate limiting for security. (Source 1)',
    expected: [1],
  },
  {
    label: 'Multiple distinct citations',
    answer: 'It has rate limiting (Source 1) and also CORS protection (Source 2).',
    expected: [1, 2],
  },
  {
    label: 'Repeated citation of the same source (should dedupe)',
    answer: 'Rate limiting is mentioned (Source 1). This is reinforced later too (Source 1).',
    expected: [1],
  },
  {
    label: 'No citations at all (e.g. the "not enough info" fallback answer)',
    answer: "I don't have enough relevant information in the uploaded documents to answer that.",
    expected: [],
  },
  {
    label: 'Citation with extra whitespace',
    answer: 'This is covered too (Source   3).',
    expected: [3],
  },
];

console.log('=== Citation Extraction Test ===\n');

let allPassed = true;
for (const { label, answer, expected } of cases) {
  const result = [...extractCitedSourceNumbers(answer)].sort((a, b) => a - b);
  const expectedSorted = [...expected].sort((a, b) => a - b);
  const passed = JSON.stringify(result) === JSON.stringify(expectedSorted);
  allPassed = allPassed && passed;
  console.log(`${passed ? '✅' : '❌'} ${label}`);
  console.log(`   answer: "${answer}"`);
  console.log(`   expected: [${expectedSorted}] | got: [${result}]\n`);
}

if (allPassed) {
  console.log('✅ All citation extraction tests passed.');
} else {
  console.error('❌ Some citation extraction tests FAILED - see above.');
  process.exit(1);
}
