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
console.assert(prompt.includes('Do NOT flag reasonable summarization'), 'FAIL: prompt should explicitly allow paraphrasing/summarization');
const promptOk = prompt.includes('Source 1') && prompt.includes('passed') && prompt.includes('Do NOT flag reasonable summarization');
console.log(promptOk ? '✅ Prompt includes sources, JSON shape instruction, and paraphrase-allowance guard' : '❌ FAILED');

if (allPassed && promptOk) {
  console.log('\n✅ All self-verification tests passed.');
} else {
  console.error('\n❌ Some self-verification tests FAILED - see above.');
  process.exit(1);
}
