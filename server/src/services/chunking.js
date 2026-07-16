const path = require('path');

const DEFAULT_CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE_WORDS || '350', 10);
const DEFAULT_OVERLAP = parseInt(process.env.CHUNK_OVERLAP_WORDS || '50', 10);

/**
 * Slides a fixed-size, overlapping window over a block of text (by word count).
 * Returns an array of plain-text chunk strings.
 */
function splitIntoWordWindows(text, chunkSizeWords = DEFAULT_CHUNK_SIZE, overlapWords = DEFAULT_OVERLAP) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= chunkSizeWords) return [words.join(' ')];

  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSizeWords, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end === words.length) break;
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

module.exports = { chunkDocument, splitIntoWordWindows };
