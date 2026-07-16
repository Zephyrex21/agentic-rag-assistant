const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

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
    const data = await pdfParse(buffer);
    return data.text;
  }

  throw new Error(`Unsupported file type: ${ext}. Supported types: .txt, .md, .pdf`);
}

function isSupportedFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ['.txt', '.md', '.pdf'].includes(ext);
}

module.exports = { extractText, isSupportedFile };
