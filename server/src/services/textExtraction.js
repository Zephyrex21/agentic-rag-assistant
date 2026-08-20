const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

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
 * Strips characters that extracted document text should never contain but
 * occasionally does, thanks to PDF font/ligature-mapping quirks - and that
 * Postgres text columns reject outright if they slip through uninspected
 * ("unsupported Unicode escape sequence"), failing the whole upload at the
 * DB insert step with a message that gives no hint it came from the PDF
 * itself. Applied to every extracted format (not just PDF) as a cheap,
 * universal safety net - a well-formed .txt/.md file is unaffected either way.
 */
function sanitizeExtractedText(text) {
  return (
    text
      // NULL bytes - Postgres text/jsonb columns cannot store these at all,
      // regardless of surrounding valid text. The single most common cause
      // of "unsupported Unicode escape sequence" from a PDF upload.
      .replace(/\u0000/g, '')
      // Lone (unpaired) UTF-16 surrogates - a valid surrogate pair is a high
      // surrogate (D800-DBFF) immediately followed by a low surrogate
      // (DC00-DFFF); either one appearing without its partner is invalid on
      // its own and can come from the same PDF font-mapping quirks.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      // Other non-printable control characters, keeping common whitespace
      // (tab, newline, carriage return) intact.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  );
}

/**
 * Extracts raw text from a file on disk based on its extension.
 * Supported: .txt, .md, .pdf
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.txt' || ext === '.md') {
    return sanitizeExtractedText(fs.readFileSync(filePath, 'utf-8'));
  }

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    try {
      const data = await withTimeout(
        pdfParse(buffer),
        PDF_EXTRACTION_TIMEOUT_MS,
        `PDF parsing timed out after ${Math.round(PDF_EXTRACTION_TIMEOUT_MS / 1000)}s - this file may be unusually large or complex for the current server resources. Try a smaller PDF, or split this one into parts.`
      );
      return sanitizeExtractedText(data.text);
    } catch (err) {
      throw new Error(describePdfError(err));
    }
  }

  if (ext === '.docx') {
    const buffer = fs.readFileSync(filePath);
    try {
      // extractRawText (not convertToHtml) - this pipeline chunks/embeds
      // plain prose, so structure beyond paragraph breaks isn't useful here.
      const { value } = await mammoth.extractRawText({ buffer });
      return sanitizeExtractedText(value);
    } catch (err) {
      throw new Error(
        `Could not read this .docx file (${err.message || 'unknown error'}). It may be corrupted, password-protected, or actually a legacy .doc file saved with a .docx extension - try re-saving it from Word and uploading again.`
      );
    }
  }

  throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .md, .pdf, .docx`);
}

function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.txt', '.md', '.pdf', '.docx'].includes(ext);
}

module.exports = { extractText, isSupportedFile, describePdfError, sanitizeExtractedText, PDF_EXTRACTION_TIMEOUT_MS };
