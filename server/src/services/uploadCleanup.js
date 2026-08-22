const fs = require('fs');
const path = require('path');
const { parseIntEnv } = require('../utils/envConfig');

// Same computation as documents.js's UPLOAD_DIR - kept as a small
// intentional duplication rather than importing from the route file
// (which would be a strange dependency direction for a route module),
// matching this codebase's existing precedent for constants that are
// cheap to duplicate but awkward to share (see agenticRag.js's comment on
// its own DEDUP_SIMILARITY_THRESHOLD for the same reasoning).
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// How old a file in uploads/ has to be before it's considered orphaned and
// swept up. Deliberately generous relative to PDF_EXTRACTION_TIMEOUT_MS
// (default 60s): any file legitimately still being processed should be
// long done well within this window, so anything still sitting there past
// it is almost certainly a leftover from a crash - a process killed
// mid-ingestion never reaches processDocument's `finally` block, which is
// what normally deletes the temp file on both success and failure (see
// workers/ingestionWorker.js).
const ORPHANED_UPLOAD_MAX_AGE_MS = parseIntEnv('ORPHANED_UPLOAD_MAX_AGE_MS', 2 * 60 * 60 * 1000, { min: 60000 }); // 2 hours

/**
 * Deletes files in the uploads directory older than
 * ORPHANED_UPLOAD_MAX_AGE_MS. Run once at server startup (see server.js) -
 * catches whatever accumulated while the previous process was down,
 * however it went down (crash, OOM kill, a host restart mid-request).
 *
 * Deliberately age-based rather than cross-referencing each file against a
 * document record: uploaded filenames (see documents.js's multer storage
 * config) don't embed the documentId, only a timestamp + sanitized
 * original name - there's no reliable way to map a leftover file back to a
 * specific (possibly already-deleted) document row anyway, so "has this
 * file been sitting here far longer than any real ingestion run should
 * ever take" is the only signal actually available.
 *
 * Fails soft throughout: a missing uploads/ directory, a permissions
 * issue, or a single file disappearing mid-sweep (a legitimate upload
 * finishing normally while this runs) are all handled without throwing -
 * this is a best-effort disk-hygiene pass, not something that should ever
 * be able to prevent the server from starting.
 */
async function sweepOrphanedUploads(dir = UPLOAD_DIR, maxAgeMs = ORPHANED_UPLOAD_MAX_AGE_MS) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return { swept: 0 }; // uploads/ doesn't exist yet - nothing to sweep
    console.warn(`[uploadCleanup] could not read uploads directory (${err.message}) - skipping sweep.`);
    return { swept: 0 };
  }

  const now = Date.now();
  let swept = 0;

  for (const name of entries) {
    if (name === '.gitkeep') continue;
    const filePath = path.join(dir, name);
    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) continue;
      if (now - stats.mtimeMs > maxAgeMs) {
        await fs.promises.unlink(filePath);
        swept += 1;
      }
    } catch (err) {
      // ENOENT here means the file disappeared between readdir and
      // stat/unlink - almost certainly a real, in-flight upload finishing
      // normally (its own `finally` block deleted it first). Expected,
      // not an error worth logging.
      if (err.code !== 'ENOENT') {
        console.warn(`[uploadCleanup] could not check/remove ${name}: ${err.message}`);
      }
    }
  }

  if (swept > 0) {
    console.log(`[uploadCleanup] removed ${swept} orphaned upload file(s) older than ${Math.round(maxAgeMs / 60000)} minutes.`);
  }
  return { swept };
}

module.exports = { sweepOrphanedUploads, UPLOAD_DIR, ORPHANED_UPLOAD_MAX_AGE_MS };
