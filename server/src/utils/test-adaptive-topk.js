/**
 * Standalone test for rag.js's adaptive top-K heuristic - no API key needed.
 * Requiring rag.js itself is safe with zero env vars set: every provider
 * client in this codebase is lazily constructed inside its functions (see
 * groqClient.js, pinecone.js, embeddings.js), never at require-time.
 * Run with: npm run test:adaptive-topk
 */
const { computeTopK, BROAD_QUESTION_RE } = require('../services/rag.js');

console.log('=== Adaptive Top-K Test ===\n');

const baseTopK = parseInt(process.env.RETRIEVAL_TOP_K || '5', 10);

const broadQuestions = [
  'Summarize this document.',
  'Give me an overview of the whole project.',
  'Compare the two approaches described here.',
  "What's the difference between plan A and plan B?",
  'List all the features mentioned.',
  'Tell me about this company.',
  'What does this document cover?',
  'What is this readme about?',
  'what is this document about?',
  "What's this repo about?",
];

const narrowQuestions = [
  'What year was the company founded?',
  'How much does the premium plan cost?',
  'Who is the CEO?',
  'What port does the server run on?',
];

let allBroadPassed = true;
for (const q of broadQuestions) {
  const topK = computeTopK(q);
  const passed = topK > baseTopK;
  allBroadPassed = allBroadPassed && passed;
  console.log(`${passed ? '✅' : '❌'} "${q}" -> topK=${topK} (expected > ${baseTopK})`);
}

let allNarrowPassed = true;
for (const q of narrowQuestions) {
  const topK = computeTopK(q);
  const passed = topK === baseTopK;
  allNarrowPassed = allNarrowPassed && passed;
  console.log(`${passed ? '✅' : '❌'} "${q}" -> topK=${topK} (expected == ${baseTopK})`);
}

console.assert(allBroadPassed, 'FAIL: not every broad question widened topK');
console.assert(allNarrowPassed, 'FAIL: not every narrow question kept the base topK');
console.assert(BROAD_QUESTION_RE.test('summarize this') === true, 'FAIL: regex sanity check failed');

console.log(
  allBroadPassed && allNarrowPassed
    ? '\n✅ All adaptive top-K classifications correct.'
    : '\n❌ Some classifications were wrong - see output above.'
);
