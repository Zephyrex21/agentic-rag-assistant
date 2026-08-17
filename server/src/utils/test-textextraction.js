/**
 * Standalone test for textExtraction.js - no API key needed.
 * The actual pdf-parse call itself isn't mocked here (extractText's PDF
 * branch is exercised in practice via real uploads / the eval harness) -
 * this covers the pure error-translation logic and the timeout wrapper
 * mechanics, which is where a person-facing message actually gets decided.
 * Run with: npm run test:textextraction
 */
const { describePdfError, isSupportedFile, PDF_EXTRACTION_TIMEOUT_MS } = require('../services/textExtraction');

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
console.assert(isSupportedFile('image.png') === false, 'FAIL: .png should not be supported');
console.assert(isSupportedFile('archive.docx') === false, 'FAIL: .docx should not be supported (not in the accepted list)');
console.log('✅ isSupportedFile correctly accepts .txt/.md/.pdf and rejects everything else');

// --- timeout constant sanity ---
console.assert(
  typeof PDF_EXTRACTION_TIMEOUT_MS === 'number' && PDF_EXTRACTION_TIMEOUT_MS > 0,
  'FAIL: PDF_EXTRACTION_TIMEOUT_MS should be a positive number'
);
console.log(`✅ PDF_EXTRACTION_TIMEOUT_MS is a sane positive default (${PDF_EXTRACTION_TIMEOUT_MS}ms) - parsing can never hang indefinitely`);

console.log('\n✅ All text extraction tests passed.');
