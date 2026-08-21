const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

// Set BEFORE requiring app.js, in a file of its own - node's test runner
// executes each matched test file as a separate process by default, so
// this doesn't leak into (and break) the other route test files, which
// all rely on APP_ACCESS_KEY being unset (auth disabled) to send
// unauthenticated requests freely.
process.env.APP_ACCESS_KEY = 'test-secret-key';

const folderStore = require('../src/db/folderStore');
const app = require('../src/app');

test('GET /api/folders - rejects a request with no access key when APP_ACCESS_KEY is set', async () => {
  const res = await request(app).get('/api/folders');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('GET /api/folders - rejects a request with the wrong access key', async () => {
  const res = await request(app).get('/api/folders').set('X-App-Access-Key', 'wrong-key');
  assert.strictEqual(res.status, 401);
});

test('GET /api/folders - accepts a request with the correct access key', async (t) => {
  t.mock.method(folderStore, 'list', async () => []);
  const res = await request(app).get('/api/folders').set('X-App-Access-Key', 'test-secret-key');
  assert.strictEqual(res.status, 200);
});

test('GET /health - stays reachable without an access key even when APP_ACCESS_KEY is set', async () => {
  const res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});
