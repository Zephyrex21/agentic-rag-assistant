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
  {
    label: 'Grouped multi-source citation - the regression case (used to extract nothing)',
    answer: 'This is a broad synthesis point (Source 1, Source 2).',
    expected: [1, 2],
  },
  {
    label: 'Three-way grouped citation',
    answer: 'Covers several areas (Source 2, Source 5, Source 6).',
    expected: [2, 5, 6],
  },
  {
    label: 'Mix of single and grouped citations, with a repeat across them (dedupes)',
    answer: 'First point (Source 1). Second point (Source 1, Source 3).',
    expected: [1, 3],
  },
  // --- Plural / range / alternative-separator shapes models produce anyway.
  // Real regression: an answer cited "(Sources 1-3)" and "(Sources 3-4)", which
  // matched nothing - the footer then said "2 sources used" for an answer that
  // drew on all 4, and no citation badges were rendered for those claims. ---
  {
    label: 'Plural range "(Sources 1-3)" expands to every source in the range',
    answer: 'Covers the unit breakdown (Sources 1-3).',
    expected: [1, 2, 3],
  },
  {
    label: 'The exact two groups from the real bug report together',
    answer: 'Units (Sources 1-3). Labs and assessment (Sources 3-4).',
    expected: [1, 2, 3, 4],
  },
  {
    label: 'Plural comma list "(Sources 1, 2)"',
    answer: 'Both agree (Sources 1, 2).',
    expected: [1, 2],
  },
  {
    label: '"and" / "&" separators',
    answer: 'First (Sources 1 and 2). Second (Sources 3 & 5).',
    expected: [1, 2, 3, 5],
  },
  {
    label: 'En dash and "to" ranges',
    answer: 'A (Sources 1\u20133). B (Sources 5 to 6).',
    expected: [1, 2, 3, 5, 6],
  },
  {
    label: 'Mixed single + range inside one group',
    answer: 'Wide claim (Source 1, Source 3-5).',
    expected: [1, 3, 4, 5],
  },
  {
    label: 'Case-insensitive on the word "Sources"',
    answer: 'Lowercase variant (sources 2-3).',
    expected: [2, 3],
  },
  // --- Things that merely look similar must NOT be read as citations. ---
  {
    label: 'Ordinary parentheses mentioning "Source" are not citations',
    answer: 'The tool is open (Source code is on GitHub). See also (Sources: the annual report) and (Source 2 of the paper).',
    expected: [],
  },
  {
    label: 'Unclosed or dangling group is not a citation',
    answer: 'Truncated mid-stream (Sources 1-3 and also (Sources 1-) here.',
    expected: [],
  },
  {
    label: 'Reversed range is kept as just its two endpoints (never expanded backwards)',
    answer: 'Odd (Sources 5-3).',
    expected: [3, 5],
  },
  {
    label: 'Absurdly wide range is NOT expanded into hundreds of numbers (capped)',
    answer: 'Malformed (Sources 1-999).',
    expected: [1, 999],
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
