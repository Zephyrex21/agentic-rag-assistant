/**
 * Standalone test for sweepOrphanedUploads - uses a real temp directory
 * with files backdated via fs.utimes, no server/API needed.
 * Run with: npm run test:uploadcleanup
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sweepOrphanedUploads } = require('../services/uploadCleanup');

async function withTempDir(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'upload-cleanup-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

async function touchFile(dir, name, ageMs) {
  const filePath = path.join(dir, name);
  await fs.promises.writeFile(filePath, 'test content');
  if (ageMs > 0) {
    const backdated = new Date(Date.now() - ageMs);
    await fs.promises.utimes(filePath, backdated, backdated);
  }
  return filePath;
}

async function main() {
  console.log('=== Orphaned Upload Cleanup Test ===\n');

  // --- 1. An old file (older than maxAgeMs) is swept ---
  await withTempDir(async (dir) => {
    await touchFile(dir, 'old_leftover.pdf', 3 * 60 * 60 * 1000); // 3h old
    const result = await sweepOrphanedUploads(dir, 2 * 60 * 60 * 1000); // 2h threshold
    assert.strictEqual(result.swept, 1);
    const remaining = await fs.promises.readdir(dir);
    assert.strictEqual(remaining.length, 0, 'FAIL: the old file should have been removed');
  });
  console.log('✅ A file older than the age threshold is removed');

  // --- 2. A recent file (within maxAgeMs) is left alone - this is the
  // critical "don't delete an in-flight upload" case. ---
  await withTempDir(async (dir) => {
    await touchFile(dir, 'recent_upload.pdf', 5 * 60 * 1000); // 5 minutes old
    const result = await sweepOrphanedUploads(dir, 2 * 60 * 60 * 1000); // 2h threshold
    assert.strictEqual(result.swept, 0, 'FAIL: a recent file must NOT be swept - it could be a legitimate in-flight upload');
    const remaining = await fs.promises.readdir(dir);
    assert.strictEqual(remaining.length, 1);
  });
  console.log('✅ A recent file (within the age threshold) is left alone - never touches an in-flight upload');

  // --- 3. .gitkeep is never touched regardless of age ---
  await withTempDir(async (dir) => {
    await touchFile(dir, '.gitkeep', 10 * 60 * 60 * 1000); // very old
    const result = await sweepOrphanedUploads(dir, 2 * 60 * 60 * 1000);
    assert.strictEqual(result.swept, 0);
    const remaining = await fs.promises.readdir(dir);
    assert.deepStrictEqual(remaining, ['.gitkeep']);
  });
  console.log('✅ .gitkeep is never swept, no matter how old');

  // --- 4. A mix of old and recent files - only the old ones go ---
  await withTempDir(async (dir) => {
    await touchFile(dir, 'old1.pdf', 5 * 60 * 60 * 1000);
    await touchFile(dir, 'old2.docx', 4 * 60 * 60 * 1000);
    await touchFile(dir, 'recent.txt', 60 * 1000);
    const result = await sweepOrphanedUploads(dir, 2 * 60 * 60 * 1000);
    assert.strictEqual(result.swept, 2);
    const remaining = await fs.promises.readdir(dir);
    assert.deepStrictEqual(remaining, ['recent.txt']);
  });
  console.log('✅ A mix of old and recent files: only the old ones are removed');

  // --- 5. A non-existent directory fails soft (returns swept: 0, doesn't throw) ---
  {
    const result = await sweepOrphanedUploads('/nonexistent/path/that/does/not/exist', 1000);
    assert.strictEqual(result.swept, 0);
  }
  console.log('✅ A missing uploads directory fails soft (no throw) instead of crashing server startup');

  // --- 6. An empty directory sweeps nothing, no error ---
  await withTempDir(async (dir) => {
    const result = await sweepOrphanedUploads(dir, 1000);
    assert.strictEqual(result.swept, 0);
  });
  console.log('✅ An empty directory sweeps nothing without error');

  console.log('\n✅ All orphaned upload cleanup tests passed.');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
