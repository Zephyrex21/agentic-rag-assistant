const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { parseIntEnv } = require('../utils/envConfig');

// A resource-constrained host (a free hosting tier, for instance) can take
// far longer to parse a PDF than a well-provisioned machine would - without
// a cap, a slow/stuck parse leaves a document sitting in "processing"
// forever instead of failing cleanly. This bounds the worst case so a
// document always ends up either ready or failed, never stuck in limbo.
const PDF_EXTRACTION_TIMEOUT_MS = parseIntEnv('PDF_EXTRACTION_TIMEOUT_MS', 60000, { min: 1000 });
// A scanned/image-only PDF still "parses" successfully (pdf-parse throws no
// exception) - there's just no real text LAYER underneath the page images
// for it to extract, only whatever sparse text a cover page, watermark, or
// embedded metadata happens to contain. Checked as chars-per-page (not a
// flat character count) so the same threshold makes sense for both a
// 1-page scan and a 40-page one. 25 is deliberately low - low enough that a
// legitimately sparse but real page (a title slide, a mostly-diagram page)
// doesn't false-positive, high enough that a page that's genuinely just a
// scanned image (0-10 stray characters from a watermark/header) still gets
// caught.
const PDF_MIN_CHARS_PER_PAGE = parseIntEnv('PDF_MIN_CHARS_PER_PAGE', 25, { min: 0 });

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
  if (/^This PDF has (no|very little) extractable text/i.test(message)) {
    return message; // already a clear, specific message from extractText's post-parse text-density check below
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
      const sanitized = sanitizeExtractedText(data.text);
      const trimmed = sanitized.trim();
      const pageCount = data.numpages || 1;
      const charsPerPage = trimmed.length / pageCount;
      const pageWord = pageCount === 1 ? 'page' : 'pages';

      // Zero text at all - the clearest, most common signal of a
      // scanned/image-based PDF (every page is a picture, nothing pdf-parse
      // can read as text).
      if (!trimmed) {
        throw new Error(
          `This PDF has no extractable text (${pageCount} ${pageWord} scanned, 0 characters found) - it looks like a scanned or image-based PDF rather than one with a real text layer underneath. Run it through OCR first (Adobe Acrobat's "Recognize Text", Google Drive's "Open with Google Docs", or a tool like OCRmyPDF all work), then re-upload the OCR'd version.`
        );
      }
      // Some text, but far too little relative to the page count - usually
      // means most pages are scanned images and only a cover page, header,
      // or watermark had real selectable text.
      if (charsPerPage < PDF_MIN_CHARS_PER_PAGE) {
        throw new Error(
          `This PDF has very little extractable text (about ${Math.round(charsPerPage)} character${Math.round(charsPerPage) === 1 ? '' : 's'} per page across ${pageCount} ${pageWord}) - it's likely mostly scanned/image content with only a small amount of real text. Run it through OCR first, then re-upload the OCR'd version.`
        );
      }

      return sanitized;
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

module.exports = {
  extractText,
  isSupportedFile,
  describePdfError,
  sanitizeExtractedText,
  PDF_EXTRACTION_TIMEOUT_MS,
  PDF_MIN_CHARS_PER_PAGE,
};
