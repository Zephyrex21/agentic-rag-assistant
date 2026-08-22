/**
 * Standalone test for usageTracker - no API key needed.
 * Run with: npm run test:usagetracker
 */
const assert = require('assert');
const usageTracker = require('../services/usageTracker');

console.log('=== Usage Tracker Test ===\n');

usageTracker._resetForTests();

// --- Groq call recording ---
usageTracker.recordGroqCall('llama-3.3-70b-versatile');
usageTracker.recordGroqCall('llama-3.3-70b-versatile');
usageTracker.recordGroqCall('llama-3.1-8b-instant');

let summary = usageTracker.getUsageSummary();
assert.strictEqual(summary.groq.totalCalls, 3);
assert.strictEqual(summary.groq.byModel['llama-3.3-70b-versatile'], 2);
assert.strictEqual(summary.groq.byModel['llama-3.1-8b-instant'], 1);
console.log('✅ Groq calls are counted per-model and summed correctly');

usageTracker.recordGroqCall(undefined);
usageTracker.recordGroqCall(null);
summary = usageTracker.getUsageSummary();
assert.strictEqual(summary.groq.totalCalls, 3, 'FAIL: a falsy model name should not be recorded as a call');
console.log('✅ recordGroqCall ignores a missing/falsy model name rather than counting it as "undefined"');

// --- Jina call recording ---
usageTracker._resetForTests();
usageTracker.recordJinaCall(1); // a single query embedding
usageTracker.recordJinaCall(25); // a batch of 25 chunks during ingestion

summary = usageTracker.getUsageSummary();
assert.strictEqual(summary.jina.totalCalls, 2, 'FAIL: expected 2 separate calls');
assert.strictEqual(summary.jina.totalTextsEmbedded, 26, 'FAIL: expected 1 + 25 = 26 texts embedded total');
console.log('✅ Jina calls track BOTH call count and total texts embedded separately (a 25-text batch is 1 call, not 25)');

usageTracker.recordJinaCall(); // default arg
summary = usageTracker.getUsageSummary();
assert.strictEqual(summary.jina.totalCalls, 3);
assert.strictEqual(summary.jina.totalTextsEmbedded, 27, 'FAIL: recordJinaCall() with no arg should default to counting 1 text');
console.log('✅ recordJinaCall() with no argument defaults to counting 1 text embedded');

// --- Summary shape ---
usageTracker._resetForTests();
summary = usageTracker.getUsageSummary();
assert.ok(summary.since, 'FAIL: summary should include a "since" timestamp');
assert.strictEqual(typeof summary.uptimeSeconds, 'number');
assert.strictEqual(summary.groq.totalCalls, 0);
assert.deepStrictEqual(summary.groq.byModel, {});
assert.strictEqual(summary.jina.totalCalls, 0);
console.log('✅ A freshly reset tracker reports zero counts with the correct summary shape');

console.log('\n✅ All usage tracker tests passed.');
