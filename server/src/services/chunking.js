const path = require('path');
const { parseIntEnv } = require('../utils/envConfig');

const DEFAULT_CHUNK_SIZE = parseIntEnv('CHUNK_SIZE_WORDS', 350, { min: 10 });
const DEFAULT_OVERLAP = parseIntEnv('CHUNK_OVERLAP_WORDS', 50, { min: 0 });

// A word ending in ./!/? (optionally followed by a closing quote/paren) is
// treated as a sentence boundary.
const SENTENCE_END_RE = /[.!?][)'"\u201d]?$/;
// How far past a hard word-count cut we'll look for a clean sentence
// boundary before giving up and using the hard cut anyway. Bounded
// deliberately - this is a quality nudge, not a license to let one chunk
// balloon in size on text with no terminal punctuation nearby (code blocks,
// data dumps, etc).
const SENTENCE_SNAP_LOOKAHEAD = 40;

/**
 * Nudges a word-count-based cut point forward to the nearest sentence
 * ending within SENTENCE_SNAP_LOOKAHEAD words, so chunks - and the
 * excerpts/citations built directly from them - read as complete thoughts
 * instead of stopping mid-sentence. Falls back to the original hard cut if
 * no sentence boundary appears within the lookahead window, so this never
 * grows a chunk unboundedly on text without punctuation.
 */
function snapToSentenceBoundary(words, hardEnd) {
  if (hardEnd >= words.length) return hardEnd;
  if (SENTENCE_END_RE.test(words[hardEnd - 1])) return hardEnd; // already lands cleanly

  const limit = Math.min(words.length, hardEnd + SENTENCE_SNAP_LOOKAHEAD);
  for (let i = hardEnd; i < limit; i++) {
    if (SENTENCE_END_RE.test(words[i])) {
      return i + 1; // include this word - boundary sits right after it
    }
  }
  return hardEnd; // no nearby sentence boundary, don't grow the chunk further
}

/**
 * Slides a fixed-size, overlapping window over a block of text (by word
 * count), snapping each cut point to the nearest sentence boundary rather
 * than slicing strictly mid-sentence. Returns an array of plain-text chunk
 * strings.
 */
function splitIntoWordWindows(text, chunkSizeWords = DEFAULT_CHUNK_SIZE, overlapWords = DEFAULT_OVERLAP) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= chunkSizeWords) return [words.join(' ')];

  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const hardEnd = Math.min(start + chunkSizeWords, words.length);
    const end = snapToSentenceBoundary(words, hardEnd);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = end - overlapWords; // step back for overlap
  }
  return chunks;
}

/**
 * Splits markdown into sections by headers (#, ##, ###...), preserving the
 * header text as metadata. Long sections are further split by word window.
 * This gives citations like "section: Projects" instead of just a raw index.
 */
function chunkMarkdown(text, opts) {
  const lines = text.split('\n');
  const sections = [];
  let currentTitle = 'Introduction';
  let currentLines = [];

  const flush = () => {
    const content = currentLines.join('\n').trim();
    if (content.length > 0) sections.push({ title: currentTitle, content });
    currentLines = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      flush();
      currentTitle = headerMatch[2].trim();
    } else {
      currentLines.push(line);
    }
  }
  flush();

  const chunks = [];
  let globalIndex = 0;
  for (const section of sections) {
    const windows = splitIntoWordWindows(section.content, opts.chunkSizeWords, opts.overlapWords);
    windows.forEach((windowText, i) => {
      chunks.push({
        text: windowText,
        chunkIndex: globalIndex++,
        section: section.title,
        subIndex: i,
      });
    });
  }
  return chunks;
}

/**
 * Splits plain text (or PDF-extracted text) by paragraph-aware word windows.
 * No header structure available, so section metadata falls back to null.
 */
function chunkPlainText(text, opts) {
  const normalized = text.replace(/\r\n/g, '\n');
  const windows = splitIntoWordWindows(normalized, opts.chunkSizeWords, opts.overlapWords);
  return windows.map((windowText, i) => ({
    text: windowText,
    chunkIndex: i,
    section: null,
    subIndex: 0,
  }));
}

/**
 * Main entry point. Dispatches to the right strategy based on file extension.
 * Returns an array of { text, chunkIndex, section, subIndex }.
 */
function chunkDocument(text, filename, options = {}) {
  const opts = {
    chunkSizeWords: options.chunkSizeWords || DEFAULT_CHUNK_SIZE,
    overlapWords: options.overlapWords || DEFAULT_OVERLAP,
  };

  const ext = path.extname(filename).toLowerCase();
  const cleaned = text.trim();
  if (!cleaned) return [];

  if (ext === '.md') {
    return chunkMarkdown(cleaned, opts);
  }
  return chunkPlainText(cleaned, opts);
}

module.exports = { chunkDocument, splitIntoWordWindows, snapToSentenceBoundary };
