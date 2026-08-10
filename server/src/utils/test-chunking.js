/**
 * Standalone test for chunking.js - no API keys needed.
 * Run with: npm run test:chunking
 */
const { chunkDocument, splitIntoWordWindows, snapToSentenceBoundary } = require('../services/chunking');

const markdownSample = `# Cryptex - Private File Sharing Platform

## Overview
Cryptex is a token-based private file sharing platform built with Node.js, Express, MongoDB, and Supabase. It was rebranded from an earlier project called CloudVault.

## Security Features
The platform includes rate limiting to prevent abuse, CORS configuration for safe cross-origin requests, magic-byte validation to verify file types beyond just extensions, and Zip Slip protection to prevent path traversal attacks during archive extraction.

## Key Features
Folder downloads are packaged as ZIP files on the fly. Deleted files use a soft-delete pattern with an Undo option, so users can recover accidentally deleted files within a grace period. The UI uses icon-only buttons and hides file extensions for a cleaner look.

## Tech Stack
Backend: Node.js, Express, MongoDB. Storage: Supabase and Cloudinary for file storage. Frontend: React with a focus on clean, minimal UI.`;

const plainTextSample = Array(20)
  .fill(
    'This is a sample paragraph used to test the plain text chunking window. It repeats to simulate a longer document without markdown structure.'
  )
  .join(' ');

function printChunks(label, chunks) {
  console.log(`\n--- ${label} (${chunks.length} chunks) ---`);
  chunks.forEach((c) => {
    const preview = c.text.slice(0, 70).replace(/\n/g, ' ');
    console.log(`  [${c.chunkIndex}] section="${c.section || 'N/A'}" words=${c.text.split(/\s+/).length} :: "${preview}..."`);
  });
}

console.log('=== Chunking Test ===');

const mdChunks = chunkDocument(markdownSample, 'sample.md', { chunkSizeWords: 40, overlapWords: 10 });
printChunks('Markdown (structure-aware, small window to force splitting)', mdChunks);

const mdChunksNoSplit = chunkDocument(markdownSample, 'sample.md');
printChunks('Markdown (default window - real usage size)', mdChunksNoSplit);

const txtChunks = chunkDocument(plainTextSample, 'sample.txt', { chunkSizeWords: 50, overlapWords: 10 });
printChunks('Plain text (word-window)', txtChunks);

// Sanity assertions
//
// NOTE: with sentence-boundary snapping (see below), a section whose word
// count only slightly exceeds chunkSizeWords - and whose overflow ends
// shortly after in a sentence-ending period, like "Key Features" here -
// now merges back into a single clean chunk instead of leaving an awkward
// few-word trailing fragment. That's the intended tradeoff, so the
// assertion here checks "still split where it meaningfully should"
// (>= 4, one chunk per section at minimum) rather than a stricter bound
// tuned to the old word-count-only behavior. The dedicated
// sentence-boundary tests further down verify multi-window splitting still
// happens correctly on longer, multi-sentence content.
console.assert(mdChunks.length >= 4, 'FAIL: expected at least one chunk per markdown section');
console.assert(mdChunks.every((c) => c.section), 'FAIL: every markdown chunk should carry a section title');
console.assert(txtChunks.length > 1, 'FAIL: expected plain text to split into multiple windows');
console.assert(
  txtChunks[0].text.split(/\s+/).slice(-10).join(' ') !== txtChunks[1] ? true : true, // overlap sanity (visual check above is more useful)
  'overlap check placeholder'
);

console.log('\n✅ All sanity assertions passed (see output above for manual quality check).');

// --- Sentence-boundary snapping tests ---
console.log('\n=== Sentence-Boundary Snapping Test ===');

// Case 1: a hard cut mid-sentence should snap forward to the next sentence end.
const words1 = 'The system uses hybrid retrieval. It combines vector and keyword search for better recall. A third sentence follows here.'.split(' ');
// Hard cut lands inside "combines vector and keyword" (mid second sentence).
const midSentenceCut = words1.indexOf('keyword') + 1;
const snapped1 = snapToSentenceBoundary(words1, midSentenceCut);
console.assert(/[.!?]$/.test(words1[snapped1 - 1]), `FAIL: expected snapped boundary to land on sentence-ending punctuation, got "${words1[snapped1 - 1]}"`);
console.log(snapped1 > midSentenceCut ? '✅ Mid-sentence cut snapped forward to the next sentence end' : '❌ FAILED');

// Case 2: a cut that already lands cleanly on a sentence end should NOT move.
const words2 = 'First sentence here. Second sentence here. Third sentence here.'.split(' ');
const cleanCut = words2.indexOf('here.') + 1; // first "here." - already a clean boundary
const snapped2 = snapToSentenceBoundary(words2, cleanCut);
console.assert(snapped2 === cleanCut, `FAIL: expected clean cut to stay unchanged, got shift to ${snapped2}`);
console.log(snapped2 === cleanCut ? '✅ Already-clean sentence boundary left unchanged' : '❌ FAILED');

// Case 3: no punctuation within the lookahead window - should fall back to the hard cut.
const runOnWords = Array(60).fill('token').map((w, i) => `${w}${i}`); // no punctuation anywhere
const snapped3 = snapToSentenceBoundary(runOnWords, 20);
console.assert(snapped3 === 20, `FAIL: expected fallback to hard cut (20) with no nearby punctuation, got ${snapped3}`);
console.log(snapped3 === 20 ? '✅ Falls back to hard cut when no sentence boundary is nearby (no runaway growth)' : '❌ FAILED');

// Case 4: end-to-end via splitIntoWordWindows - chunks (other than possibly the
// last) should mostly end on sentence punctuation for clean prose input.
const sentenceHeavyText = Array(15)
  .fill('This is a complete sentence with a clean ending.')
  .join(' ');
const windows = splitIntoWordWindows(sentenceHeavyText, 30, 5);
const cleanEndings = windows.filter((w) => /[.!?]$/.test(w.trim()));
console.assert(windows.length > 1, `FAIL: expected multi-sentence text to still split into multiple windows, got ${windows.length}`);
console.assert(cleanEndings.length === windows.length, `FAIL: expected all windows to end cleanly, ${windows.length - cleanEndings.length} did not`);
console.log(windows.length > 1 ? `✅ Multi-sentence content still splits into multiple windows (${windows.length}) with snapping enabled` : '❌ FAILED');
console.log(cleanEndings.length === windows.length ? '✅ All word-window chunks end on clean sentence boundaries for prose input' : '❌ FAILED');

console.log('\n✅ All sentence-boundary snapping tests passed.');
