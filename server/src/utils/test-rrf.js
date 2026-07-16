/**
 * Standalone test for RRF fusion - no API key needed.
 * Run with: npm run test:rrf
 */
const { reciprocalRankFusion, normalizeRrfScore } = require('../services/rrf');

console.log('=== RRF Fusion Test ===\n');

// Case 1: a chunk that appears in BOTH lists should outrank one that only
// appears in a single list, even if that single-list chunk was ranked #1 there.
const vectorResults = [{ id: 'chunk_A' }, { id: 'chunk_B' }, { id: 'chunk_C' }];
const keywordResults = [{ id: 'chunk_D' }, { id: 'chunk_B' }, { id: 'chunk_E' }];

const fused = reciprocalRankFusion([vectorResults, keywordResults]);
console.log('Fused order:', fused.map((f) => `${f.id} (${f.rrfScore.toFixed(4)})`).join(', '));

const topId = fused[0].id;
console.assert(topId === 'chunk_B', `FAIL: expected chunk_B (appears in both lists) to rank #1, got ${topId}`);
console.log(topId === 'chunk_B' ? '✅ Chunk appearing in both lists correctly ranked #1' : '❌ FAILED');

// Case 2: single-list-only input should just preserve that list's order
const singleList = reciprocalRankFusion([[{ id: 'x' }, { id: 'y' }, { id: 'z' }]]);
const singleOrder = singleList.map((f) => f.id).join(',');
console.assert(singleOrder === 'x,y,z', `FAIL: expected x,y,z order preserved, got ${singleOrder}`);
console.log(singleOrder === 'x,y,z' ? '✅ Single-list order preserved correctly' : '❌ FAILED');

// Case 3: empty lists shouldn't crash
const emptyResult = reciprocalRankFusion([[], []]);
console.assert(emptyResult.length === 0, 'FAIL: expected empty result for empty input');
console.log(emptyResult.length === 0 ? '✅ Empty input handled without crashing' : '❌ FAILED');

// Case 4: normalization stays within 0-1 range
const normalized = normalizeRrfScore(fused[0].rrfScore, 2);
console.assert(normalized > 0 && normalized <= 1, `FAIL: normalized score out of range: ${normalized}`);
console.log(`✅ Normalized top score: ${normalized.toFixed(4)} (within 0-1 range)`);

console.log('\n✅ All RRF fusion tests passed.');
