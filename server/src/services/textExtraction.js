const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// A resource-constrained host (a free hosting tier, for instance) can take
// far longer to parse a PDF than a well-provisioned machine would - without
// a cap, a slow/stuck parse leaves a document sitting in "processing"
// forever instead of failing cleanly. This bounds the worst case so a
// document always ends up either ready or failed, never stuck in limbo.
const PDF_EXTRACTION_TIMEOUT_MS = parseInt(process.env.PDF_EXTRACTION_TIMEOUT_MS || '60000', 10);

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Turns whatever pdf-parse/pdf.js throws into a message that actually tells
 * someone what to do about it - the raw errors from that stack are either
 * generic ("Error") or full of internal pdf.js jargon a person uploading a
 * document has no way to act on.
 */
function describePdfError(err) {
  const name = err?.name || '';
  const message = err?.message || '';

  if (name === 'PasswordException' || /password/i.test(message)) {
    return 'This PDF is password-protected. Remove the password and re-upload it.';
  }
  if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
    return 'This file doesn\'t look like a valid PDF - it may be corrupted, or renamed from a different file type.';
  }
  if (/timed out/i.test(message)) {
    return message; // already a clear, specific message from withTimeout above
  }
  return `Could not read this PDF (${message || 'unknown error'}). Try re-saving/re-exporting it and uploading again.`;
}

/**
 * Extracts raw text from a file on disk based on its extension.
 * Supported: .txt, .md, .pdf
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    try {
      const data = await withTimeout(
        pdfParse(buffer),
        PDF_EXTRACTION_TIMEOUT_MS,
        `PDF parsing timed out after ${Math.round(PDF_EXTRACTION_TIMEOUT_MS / 1000)}s - this file may be unusually large or complex for the current server resources. Try a smaller PDF, or split this one into parts.`
      );
      return data.text;
    } catch (err) {
      throw new Error(describePdfError(err));
    }
  }

  throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .md, .pdf`);
}

function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.txt', '.md', '.pdf'].includes(ext);
}

module.exports = { extractText, isSupportedFile, describePdfError, PDF_EXTRACTION_TIMEOUT_MS };
