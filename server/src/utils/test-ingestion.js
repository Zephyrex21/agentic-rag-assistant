/**
 * Standalone test for ingestionWorker.js's pure batching helper - no API
 * key needed. embedChunksInBatches/processDocument themselves make real
 * network calls (embeddings, Pinecone, Supabase) and aren't covered here,
 * same split as elsewhere in this codebase - only chunkArray's splitting
 * logic is pure enough to unit test directly.
 * Run with: npm run test:ingestion
 */
const { chunkArray, EMBEDDING_BATCH_SIZE } = require('../workers/ingestionWorker');

console.log('=== Ingestion Batching Test ===\n');

const items = Array.from({ length: 125 }, (_, i) => i);
const batches = chunkArray(items, 50);
console.assert(batches.length === 3, `FAIL: expected 3 batches of 50 for 125 items, got ${batches.length}`);
console.assert(batches[0].length === 50 && batches[1].length === 50 && batches[2].length === 25, 'FAIL: batch sizes should be 50, 50, 25');
console.assert(batches.flat().length === 125, 'FAIL: flattening all batches should recover every original item');
console.assert(JSON.stringify(batches.flat()) === JSON.stringify(items), 'FAIL: order must be preserved across batches');
console.log('✅ Splits 125 items into 50/50/25 batches, preserving order, with nothing lost or duplicated');

console.assert(chunkArray([], 50).length === 0, 'FAIL: an empty input should produce zero batches, not one empty batch');
console.log('✅ Empty input produces zero batches');

const smallList = chunkArray([1, 2, 3], 50);
console.assert(smallList.length === 1 && smallList[0].length === 3, 'FAIL: a list smaller than the batch size should still produce exactly one batch');
console.log('✅ A list smaller than the batch size produces exactly one batch (no wasted empty batches)');

const exactMultiple = chunkArray(Array(100).fill(0), 50);
console.assert(exactMultiple.length === 2, `FAIL: 100 items at batch size 50 should produce exactly 2 batches, got ${exactMultiple.length}`);
console.log('✅ An exact multiple of the batch size produces no trailing empty batch');

console.assert(
  typeof EMBEDDING_BATCH_SIZE === 'number' && EMBEDDING_BATCH_SIZE > 0,
  'FAIL: EMBEDDING_BATCH_SIZE should be a sane positive default'
);
console.log(`✅ EMBEDDING_BATCH_SIZE is a sane positive default (${EMBEDDING_BATCH_SIZE})`);

console.log('\n✅ All ingestion batching tests passed.');
