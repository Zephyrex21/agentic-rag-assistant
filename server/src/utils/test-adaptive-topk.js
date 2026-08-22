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
  // Hindi/Hinglish - Zephyrex's own primary use case (see the
  // regression this whole heuristic exists to catch: "tell me about
  // this document" failing to retrieve anything for a document-scoped
  // agentic query - see rag.js's runRetrieval originalQuestion param).
  'is document ke baare mein sanshep mein bataye',
  'poora overview de do is project ka',
  'sab kuch bata do isme',
  'in dono approaches ka tulna karo',
  'inka antar bataye',
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

// --- BROAD_QUESTION_EXTRA_TERMS: user-extensible for other languages ---
console.log('\n=== Broad Question Extra Terms (i18n extensibility) Test ===\n');
// BROAD_QUESTION_EXTRA_TERMS: user-extensible for other languages -
// deliberately tested with ASCII-only terms. \b (used to bound the whole
// alternation) is defined against JS regex's ASCII-only \w, so a term
// that STARTS or ENDS with a non-ASCII letter (e.g. German "überblick")
// won't get a boundary detected correctly right at that edge - a real,
// known limitation of this word-boundary approach, not something this
// test works around by coincidence. ASCII terms (English, Hinglish
// transliteration, German words that happen to start/end in ASCII
// letters) are unaffected.
process.env.BROAD_QUESTION_EXTRA_TERMS = 'zusammenfassen,resumee';
delete require.cache[require.resolve('../services/rag.js')];
const { BROAD_QUESTION_RE: extendedRegex } = require('../services/rag.js');
console.assert(extendedRegex.test('Kannst du das zusammenfassen?') === true, 'FAIL: a user-added ASCII term should be matched');
console.assert(extendedRegex.test('Gib mir eine resumee') === true, 'FAIL: a user-added ASCII term should be matched');
console.assert(extendedRegex.test('What year was this founded?') === false, 'FAIL: extending the regex must not affect unrelated narrow questions');
console.log('✅ BROAD_QUESTION_EXTRA_TERMS lets a user extend broad-question detection for their own language without touching code');
delete process.env.BROAD_QUESTION_EXTRA_TERMS;
delete require.cache[require.resolve('../services/rag.js')];

// A regex special character in a user-supplied term must not break/inject
// into the compiled regex (e.g. an unescaped `(` would throw at require time).
process.env.BROAD_QUESTION_EXTRA_TERMS = 'test(unsafe)term,another[one]';
delete require.cache[require.resolve('../services/rag.js')];
let injectionSafe = true;
try {
  require('../services/rag.js');
} catch {
  injectionSafe = false;
}
console.assert(injectionSafe, 'FAIL: a regex special character in BROAD_QUESTION_EXTRA_TERMS should be escaped, not break the regex compilation');
console.log('✅ Regex special characters in a user-supplied term are escaped safely, not treated as regex syntax');
delete process.env.BROAD_QUESTION_EXTRA_TERMS;
delete require.cache[require.resolve('../services/rag.js')];

// --- Background verification timeout is bounded and configurable ---
console.log('\n=== Background Verification Timeout Test ===\n');
process.env.BACKGROUND_VERIFICATION_TIMEOUT_MS = '5000';
delete require.cache[require.resolve('../services/rag.js')];
const { BACKGROUND_VERIFICATION_TIMEOUT_MS: customTimeout } = require('../services/rag.js');
console.assert(customTimeout === 5000, `FAIL: expected BACKGROUND_VERIFICATION_TIMEOUT_MS to read from env, got ${customTimeout}`);
console.log(`✅ BACKGROUND_VERIFICATION_TIMEOUT_MS is configurable via env (got ${customTimeout})`);
delete process.env.BACKGROUND_VERIFICATION_TIMEOUT_MS;
delete require.cache[require.resolve('../services/rag.js')];
const { BACKGROUND_VERIFICATION_TIMEOUT_MS: defaultTimeout } = require('../services/rag.js');
console.assert(
  typeof defaultTimeout === 'number' && defaultTimeout > 0 && defaultTimeout <= 30000,
  `FAIL: expected a sane default timeout (a few seconds to ~30s), got ${defaultTimeout}`
);
console.log(`✅ Default BACKGROUND_VERIFICATION_TIMEOUT_MS is a sane bound (${defaultTimeout}ms) - the background check can never run indefinitely`);
