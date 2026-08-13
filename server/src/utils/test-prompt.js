/**
 * Standalone test for llm.js's prompt construction - no API key needed.
 * Run with: node src/utils/test-prompt.js
 */
const { buildPrompt, formatHint } = require('../services/llm');

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

// --- Empty chunks (agentic mode's "skipped search" case, e.g. a greeting) ---
const noChunksPrompt = buildPrompt('Hey, thanks for the help!', []);
console.log('\n=== Prompt with ZERO chunks (skipped-search case) ===\n');
console.log(noChunksPrompt);
console.assert(!noChunksPrompt.includes('SOURCES:'), 'FAIL: the zero-chunk prompt should not have a SOURCES section at all');
console.assert(noChunksPrompt.includes("didn't appear to need a document lookup"), 'FAIL: missing the no-search-happened framing');
console.assert(/greeting|thank-you/.test(noChunksPrompt), 'FAIL: missing small-talk handling guidance');
console.assert(/do not guess|outside knowledge/i.test(noChunksPrompt), 'FAIL: zero-chunk prompt must still forbid answering from outside knowledge');
console.log('✅ Zero-chunk prompt has no SOURCES section, but still forbids guessing on real content questions.');

const noChunksWithHistory = buildPrompt('anything else?', [], [{ role: 'user', content: 'What is Cryptex?' }]);
console.assert(noChunksWithHistory.includes('CONVERSATION SO FAR'), 'FAIL: history should still thread through the zero-chunk prompt');
console.log('✅ Conversation history still included even when there are zero chunks.');

// --- Structured formatting rules + format hints ---
console.log('\n=== Structured Formatting Test ===\n');

console.assert(/markdown table/i.test(prompt), 'FAIL: prompt should instruct table usage for comparable data');
console.assert(/bulleted list/i.test(prompt) && /numbered list/i.test(prompt), 'FAIL: prompt should distinguish bulleted vs numbered list usage');
console.assert(/Use bold for/i.test(prompt), 'FAIL: prompt should instruct selective bold usage');
console.assert(/headers/i.test(prompt) && /##/.test(prompt), 'FAIL: prompt should instruct header usage for multi-part answers');
console.assert(/code block/i.test(prompt), 'FAIL: prompt should instruct code block usage for code/commands/config');
console.assert(/don't force a list, table, or header/i.test(prompt) || /don't force a list, table, header, or diagram/i.test(prompt), 'FAIL: prompt should still guard against over-structuring simple answers');
console.log('✅ Base prompt includes differentiated guidance for tables, lists, bold, headers, and code blocks - plus the anti-over-structuring guard');

console.assert(/```mermaid/.test(prompt), 'FAIL: prompt should mention mermaid fenced-block syntax for diagrams');
console.assert(/sparingly/i.test(prompt), 'FAIL: prompt should frame diagrams as occasional, not default');
console.assert(/isn't valid inside diagram syntax/i.test(prompt), 'FAIL: prompt should warn against citations inside diagram blocks');
console.log('✅ Diagram guidance present: mermaid fenced-block syntax, framed as sparing/occasional, with a citation-placement warning');

// formatHint: comparison questions
const comparisonHint = formatHint('Compare the security features of Cryptex vs WS Inspector');
console.assert(/markdown table/i.test(comparisonHint), 'FAIL: a comparison question should hint toward a table');
console.log('✅ Comparison-shaped question hints toward a table');

// formatHint: steps questions
const stepsHint = formatHint('How do I deploy this to Render?');
console.assert(/numbered list/i.test(stepsHint), 'FAIL: a steps question should hint toward a numbered list');
console.log('✅ Steps-shaped question hints toward a numbered list');

// formatHint: list questions
const listHint = formatHint('What are the features of the folder system?');
console.assert(/bulleted list/i.test(listHint), 'FAIL: a "what are the" question should hint toward a bulleted list');
console.log('✅ Enumerable-shaped question hints toward a bulleted list');

// formatHint: plain factual question should get no hint at all
const noHint = formatHint('What year was Cryptex first released?');
console.assert(noHint === '', `FAIL: a narrow factual question should get no format hint, got: "${noHint}"`);
console.log('✅ Narrow factual question gets no format hint (stays unstructured prose)');

// formatHint respects the ENABLE_FORMAT_HINTS toggle
process.env.ENABLE_FORMAT_HINTS = 'false';
delete require.cache[require.resolve('../services/llm')];
const { formatHint: formatHintDisabled } = require('../services/llm');
console.assert(formatHintDisabled('Compare X and Y') === '', 'FAIL: ENABLE_FORMAT_HINTS=false should suppress all hints');
console.log('✅ ENABLE_FORMAT_HINTS=false correctly suppresses hints');
delete process.env.ENABLE_FORMAT_HINTS;
delete require.cache[require.resolve('../services/llm')];

// The hint should actually be threaded into buildPrompt's output for a
// comparison-shaped question.
const { buildPrompt: buildPromptFresh } = require('../services/llm');
const comparisonPrompt = buildPromptFresh('Compare X vs Y', sampleChunks);
console.assert(/comparison question/i.test(comparisonPrompt), 'FAIL: buildPrompt should thread the format hint into the final prompt text');
console.log('✅ Format hint is actually threaded into the assembled prompt, not just returned standalone');

console.log('\n✅ All structured formatting tests passed.');
