const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const usageTracker = require('../src/services/usageTracker');
const app = require('../src/app');

test('GET /api/usage - returns the current in-memory usage summary', async () => {
  usageTracker._resetForTests();
  usageTracker.recordGroqCall('llama-3.3-70b-versatile');
  usageTracker.recordJinaCall(5);

  const res = await request(app).get('/api/usage');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.groq.totalCalls, 1);
  assert.strictEqual(res.body.groq.byModel['llama-3.3-70b-versatile'], 1);
  assert.strictEqual(res.body.jina.totalCalls, 1);
  assert.strictEqual(res.body.jina.totalTextsEmbedded, 5);
  assert.ok(res.body.since);
});

test('GET /api/usage - a fresh server reports zero counts', async () => {
  usageTracker._resetForTests();
  const res = await request(app).get('/api/usage');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.groq.totalCalls, 0);
  assert.strictEqual(res.body.jina.totalCalls, 0);
});
