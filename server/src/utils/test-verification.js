/**
 * Standalone test for selfVerification.js's response parsing - no API key needed.
 * Run with: npm run test:verification
 */
const { parseVerifyResponse, buildVerifyPrompt } = require('../services/selfVerification');

console.log('=== Self-Verification Parsing Test ===\n');

const cases = [
  { label: 'Clean pass', raw: '{"passed": true}', expectPassed: true, expectIssue: null },
  {
    label: 'Clean fail with issue',
    raw: '{"passed": false, "issue": "The answer states the price is $50 but no source mentions pricing."}',
    expectPassed: false,
    expectIssue: 'The answer states the price is $50 but no source mentions pricing.',
  },
  {
    label: 'JSON with surrounding text (model added preamble anyway)',
    raw: 'Here is my check: {"passed": false, "issue": "Claims a 2024 release date not found in sources."}',
    expectPassed: false,
    expectIssue: 'Claims a 2024 release date not found in sources.',
  },
  { label: 'Malformed - no JSON at all (fail OPEN, not closed)', raw: 'looks fine to me', expectPassed: true, expectIssue: null },
  {
    label: 'passed:false but missing issue field (fail OPEN - malformed shape)',
    raw: '{"passed": false}',
    expectPassed: true,
    expectIssue: null,
  },
  { label: 'Empty/undefined input (fail OPEN)', raw: undefined, expectPassed: true, expectIssue: null },
  { label: 'Garbage JSON (fail OPEN)', raw: '{passed: tru}', expectPassed: true, expectIssue: null },
];

let allPassed = true;
for (const { label, raw, expectPassed, expectIssue } of cases) {
  const result = parseVerifyResponse(raw);
  const passed = result.passed === expectPassed && result.issue === expectIssue;
  allPassed = allPassed && passed;
  console.log(`${passed ? '✅' : '❌'} ${label}`);
  console.log(`   raw: ${JSON.stringify(raw)}`);
  console.log(`   got: ${JSON.stringify(result)} | expected: passed=${expectPassed}, issue=${JSON.stringify(expectIssue)}\n`);
}

// Sanity check the prompt builder
const prompt = buildVerifyPrompt(
  'What security features does this have?',
  'It has rate limiting and encryption. (Source 1)',
  [{ filename: 'doc.md', section: 'Security', fullText: 'Rate limiting prevents abuse.' }]
);
console.assert(prompt.includes('Source 1'), 'FAIL: prompt should list numbered sources');
console.assert(prompt.includes('passed'), 'FAIL: prompt should request the passed/issue JSON shape');
console.assert(/reasonable summarization, paraphrasing, rewording/i.test(prompt), 'FAIL: prompt should explicitly allow paraphrasing/summarization');
console.assert(/when in doubt, pass/i.test(prompt), 'FAIL: prompt should explicitly bias toward passing when uncertain');
const promptOk =
  prompt.includes('Source 1') && prompt.includes('passed') && /reasonable summarization, paraphrasing, rewording/i.test(prompt);
console.log(promptOk ? '✅ Prompt includes sources, JSON shape instruction, and paraphrase-allowance guard' : '❌ FAILED');

if (allPassed && promptOk) {
  console.log('\n✅ All self-verification tests passed.');
} else {
  console.error('\n❌ Some self-verification tests FAILED - see above.');
  process.exit(1);
}

// --- isBroad leniency ---
console.log('\n=== Broad-Question Leniency Test ===\n');

const narrowPrompt = buildVerifyPrompt(
  'What year was Cryptex founded?',
  'Cryptex was founded in 2024. (Source 1)',
  [{ filename: 'doc.md', section: 'Overview', fullText: 'Cryptex was founded in 2024.' }],
  { isBroad: false }
);
console.assert(!narrowPrompt.includes('broad, multi-part question'), 'FAIL: a narrow question should NOT get the broad-question leniency note');
console.log('✅ A narrow question does not get the broad-question leniency note');

const broadPrompt = buildVerifyPrompt(
  'What is this readme about?',
  'This is a study platform with several features. (Source 1, Source 2)',
  [{ filename: 'doc.md', section: 'Overview', fullText: 'StudySage is a study platform.' }],
  { isBroad: true }
);
console.assert(broadPrompt.includes('broad, multi-part question'), 'FAIL: a broad question should get the leniency note');
console.assert(/synthesize/i.test(broadPrompt), 'FAIL: broad-question note should explicitly frame synthesis as expected, not a problem');
console.log('✅ A broad question gets the leniency note, framing synthesis/rewording as expected rather than a failure');

// isBroad defaults to false when not passed at all (backward compatible call shape)
const defaultPrompt = buildVerifyPrompt('What year was Cryptex founded?', 'Cryptex was founded in 2024.', [
  { filename: 'doc.md', fullText: 'Cryptex was founded in 2024.' },
]);
console.assert(!defaultPrompt.includes('broad, multi-part question'), 'FAIL: omitting the options argument entirely should default to isBroad=false');
console.log('✅ Omitting the options argument defaults to isBroad=false (backward compatible)');

console.log('\n✅ All broad-question leniency tests passed.');

// --- Truncation should preserve a full default-sized chunk ---
// Regression guard: a 150-word cap (the old value) would slice a
// ~350-word chunk in half, potentially cutting off the exact sentence
// that supports a claim made later in the chunk - leading the verifier
// to wrongly flag a perfectly-supported claim as unsupported.
console.log('\n=== Verify Excerpt Length Test ===\n');

const fullChunkText = Array(340).fill('word').map((w, i) => `${w}${i}`).join(' ') + ' finalcanary';
const promptWithLongSource = buildVerifyPrompt('What does the source say?', 'An answer. (Source 1)', [
  { filename: 'doc.md', fullText: fullChunkText },
]);
console.assert(
  promptWithLongSource.includes('finalcanary'),
  'FAIL: a default-sized chunk (~340 words) should not be truncated before its end in the verify prompt'
);
console.log('✅ A default-sized chunk (~340 words) is included in full, not truncated mid-chunk');
