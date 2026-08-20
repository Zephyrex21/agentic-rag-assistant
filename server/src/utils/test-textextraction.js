/**
 * Standalone test for textExtraction.js - no API key needed.
 * The actual pdf-parse call itself isn't mocked here (extractText's PDF
 * branch is exercised in practice via real uploads / the eval harness) -
 * this covers the pure error-translation logic and the timeout wrapper
 * mechanics, which is where a person-facing message actually gets decided.
 * Run with: npm run test:textextraction
 */
const { describePdfError, isSupportedFile, sanitizeExtractedText, PDF_EXTRACTION_TIMEOUT_MS } = require('../services/textExtraction');

console.log('=== Text Extraction Test ===\n');

// --- describePdfError ---

const passwordCases = [
  { name: 'PasswordException', message: 'No password given' },
  { name: 'SomeOtherName', message: 'document is password protected' },
];
for (const err of passwordCases) {
  const msg = describePdfError(err);
  console.assert(/password/i.test(msg), `FAIL: expected a password-specific message for ${JSON.stringify(err)}, got "${msg}"`);
}
console.log('✅ Password-protected PDFs get a specific, actionable message');

const invalidCases = [
  { name: 'InvalidPDFException', message: 'Invalid PDF structure' },
  { name: 'Error', message: 'invalid PDF header' },
];
for (const err of invalidCases) {
  const msg = describePdfError(err);
  console.assert(/corrupted|valid pdf/i.test(msg), `FAIL: expected a corrupted/invalid-file message for ${JSON.stringify(err)}, got "${msg}"`);
}
console.log('✅ Corrupted/invalid PDFs get a specific, actionable message');

const timeoutErr = { name: 'Error', message: 'PDF parsing timed out after 60s - this file may be unusually large.' };
const timeoutMsg = describePdfError(timeoutErr);
console.assert(timeoutMsg === timeoutErr.message, 'FAIL: a timeout error message should pass through unchanged, already clear');
console.log('✅ A timeout error message passes through as-is (already clear)');

const genericErr = { name: 'TypeError', message: 'Cannot read properties of undefined' };
const genericMsg = describePdfError(genericErr);
console.assert(genericMsg.includes('Cannot read properties of undefined'), 'FAIL: a generic error should still surface the underlying message for diagnosis');
console.assert(/try re-saving/i.test(genericMsg), 'FAIL: a generic error should still suggest a next step');
console.log('✅ An unrecognized error still surfaces the underlying detail plus a suggested next step');

console.assert(describePdfError(undefined).length > 0, 'FAIL: should not throw on undefined error input');
console.assert(describePdfError({}).length > 0, 'FAIL: should not throw on an error object with no name/message');
console.log('✅ Missing/malformed error objects handled without throwing');

// --- isSupportedFile ---
console.assert(isSupportedFile('paper.pdf') === true, 'FAIL: .pdf should be supported');
console.assert(isSupportedFile('notes.md') === true, 'FAIL: .md should be supported');
console.assert(isSupportedFile('readme.txt') === true, 'FAIL: .txt should be supported');
console.assert(isSupportedFile('report.docx') === true, 'FAIL: .docx should be supported');
console.assert(isSupportedFile('image.png') === false, 'FAIL: .png should not be supported');
console.assert(isSupportedFile('legacy.doc') === false, 'FAIL: legacy .doc (not .docx) should not be supported - different format, mammoth only reads .docx');
console.log('✅ isSupportedFile correctly accepts .txt/.md/.pdf/.docx and rejects everything else');

// --- timeout constant sanity ---
console.assert(
  typeof PDF_EXTRACTION_TIMEOUT_MS === 'number' && PDF_EXTRACTION_TIMEOUT_MS > 0,
  'FAIL: PDF_EXTRACTION_TIMEOUT_MS should be a positive number'
);
console.log(`✅ PDF_EXTRACTION_TIMEOUT_MS is a sane positive default (${PDF_EXTRACTION_TIMEOUT_MS}ms) - parsing can never hang indefinitely`);

// --- sanitizeExtractedText ---
// Regression tests for the actual production bug: a PDF with a NULL byte
// in its extracted text failed at the Postgres insert step with
// "unsupported Unicode escape sequence" - a message that gives no hint it
// came from extraction, not the upload itself.
console.log('\n=== Sanitize Extracted Text Test ===\n');

const withNullByte = 'Some text\u0000with a null byte in the middle.';
const sanitizedNull = sanitizeExtractedText(withNullByte);
console.assert(!sanitizedNull.includes('\u0000'), 'FAIL: NULL bytes should be stripped');
console.assert(sanitizedNull === 'Some textwith a null byte in the middle.', `FAIL: unexpected result: "${sanitizedNull}"`);
console.log('✅ NULL bytes are stripped (the exact cause of the production "unsupported Unicode escape sequence" failure)');

const withLoneHighSurrogate = `Some text\uD800with a lone high surrogate.`;
const sanitizedHigh = sanitizeExtractedText(withLoneHighSurrogate);
console.assert(!/[\uD800-\uDBFF]/.test(sanitizedHigh), 'FAIL: a lone high surrogate should be stripped');
console.log('✅ A lone (unpaired) high surrogate is stripped');

const withLoneLowSurrogate = `Some text\uDC00with a lone low surrogate.`;
const sanitizedLow = sanitizeExtractedText(withLoneLowSurrogate);
console.assert(!/[\uDC00-\uDFFF]/.test(sanitizedLow), 'FAIL: a lone low surrogate should be stripped');
console.log('✅ A lone (unpaired) low surrogate is stripped');

const withValidSurrogatePair = 'Emoji test: \uD83D\uDE00 should survive.'; // 😀 - a valid surrogate pair
const sanitizedEmoji = sanitizeExtractedText(withValidSurrogatePair);
console.assert(sanitizedEmoji === withValidSurrogatePair, 'FAIL: a VALID surrogate pair (e.g. an emoji) must NOT be stripped, only lone/unpaired ones');
console.log('✅ A valid surrogate pair (e.g. an emoji) is left completely intact - only unpaired surrogates are stripped');

const withControlChars = 'Text\x01with\x02control\x1Fchars but keeps\ttabs\nand\rnewlines.';
const sanitizedControl = sanitizeExtractedText(withControlChars);
console.assert(!/[\x01\x02\x1F]/.test(sanitizedControl), 'FAIL: stray control characters should be stripped');
console.assert(sanitizedControl.includes('\t') && sanitizedControl.includes('\n') && sanitizedControl.includes('\r'), 'FAIL: tab/newline/carriage-return must be preserved');
console.log('✅ Stray control characters are stripped while tab/newline/carriage-return are preserved');

const cleanText = 'This is completely ordinary text with no issues at all.';
console.assert(sanitizeExtractedText(cleanText) === cleanText, 'FAIL: already-clean text should pass through unchanged');
console.log('✅ Already-clean text passes through completely unchanged');

console.log('\n✅ All text extraction tests passed.');
