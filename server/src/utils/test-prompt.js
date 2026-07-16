/**
 * Standalone test for llm.js's prompt construction - no API key needed.
 * Run with: node src/utils/test-prompt.js
 */
const { buildPrompt } = require('../services/llm');

const sampleChunks = [
  {
    filename: 'cryptex-readme.md',
    section: 'Overview',
    text: 'Cryptex is a token-based private file sharing platform built with Node.js, Express, MongoDB, and Supabase.',
  },
  {
    filename: 'cryptex-readme.md',
    section: 'Security Features',
    text: 'The platform includes rate limiting, CORS configuration, magic-byte validation, and Zip Slip protection.',
  },
];

const prompt = buildPrompt('What security features does Cryptex have?', sampleChunks);

console.log('=== Generated Prompt ===\n');
console.log(prompt);
console.log('\n=== Sanity checks ===');
console.assert(prompt.includes('Source 1'), 'FAIL: missing Source 1 label');
console.assert(prompt.includes('Source 2'), 'FAIL: missing Source 2 label');
console.assert(prompt.includes('cryptex-readme.md'), 'FAIL: missing filename');
console.assert(prompt.includes('Security Features'), 'FAIL: missing section name');
console.assert(prompt.includes('ONLY the source excerpts'), 'FAIL: missing grounding instruction');
console.log('✅ Prompt structure looks correct - filenames, sections, and source numbering all present.');

// --- Phase 3: conversation history test ---
const historyPrompt = buildPrompt(
  'What about the second one?',
  sampleChunks,
  [
    { role: 'user', content: 'What security features does Cryptex have?' },
    { role: 'assistant', content: 'It has rate limiting and CORS configuration. (Source 2)' },
  ]
);
console.log('\n=== Prompt WITH conversation history ===\n');
console.log(historyPrompt);
console.assert(historyPrompt.includes('CONVERSATION SO FAR'), 'FAIL: missing history block');
console.assert(historyPrompt.includes('User: What security features'), 'FAIL: missing prior user turn');
console.assert(historyPrompt.includes('Assistant: It has rate limiting'), 'FAIL: missing prior assistant turn');
console.log('\n✅ Conversation history correctly threaded into the prompt.');
