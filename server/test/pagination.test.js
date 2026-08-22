const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const documentStore = require('../src/db/documentStore');
const conversationStore = require('../src/db/conversationStore');
const app = require('../src/app');

// Regression coverage for the fix: documentStore.list/conversationStore.
// listConversations used to always fetch every row - fine at small scale,
// a real problem once the document/conversation count grows. Pagination is
// OPT-IN (limit/offset both optional) specifically so every existing
// caller - the routes with no query params, agentTools.listReadyDocuments,
// etc. - is completely unaffected; these tests cover both the new opt-in
// behavior and that the old no-params behavior is untouched.

test('GET /api/documents - with no limit/offset, calls documentStore.list with no pagination options (unchanged default behavior)', async (t) => {
  let receivedOptions;
  t.mock.method(documentStore, 'list', async (options) => {
    receivedOptions = options;
    return [];
  });
  const res = await request(app).get('/api/documents');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(receivedOptions.limit, undefined);
  assert.strictEqual(res.body.hasMore, undefined, 'FAIL: hasMore should be omitted entirely when pagination was not requested');
});

test('GET /api/documents - with ?limit=2, passes limit/offset through and reports hasMore correctly', async (t) => {
  let receivedOptions;
  t.mock.method(documentStore, 'list', async (options) => {
    receivedOptions = options;
    // Return exactly `limit` rows - the "there might be more" case.
    return Array.from({ length: options.limit }, (_, i) => ({
      id: `d${i}`,
      filename: `f${i}.pdf`,
      status: 'ready',
      chunkCount: 1,
      uploadedAt: 'now',
      folderId: null,
    }));
  });
  const res = await request(app).get('/api/documents?limit=2');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(receivedOptions.limit, 2);
  assert.strictEqual(receivedOptions.offset, 0, 'FAIL: offset should default to 0 when omitted');
  assert.strictEqual(res.body.documents.length, 2);
  assert.strictEqual(res.body.hasMore, true, 'FAIL: exactly `limit` rows returned means another page might exist');
});

test('GET /api/documents - fewer rows than limit means hasMore is false (last page)', async (t) => {
  t.mock.method(documentStore, 'list', async () => [{ id: 'd0', filename: 'f0.pdf', status: 'ready', chunkCount: 1, uploadedAt: 'now', folderId: null }]);
  const res = await request(app).get('/api/documents?limit=5');
  assert.strictEqual(res.body.hasMore, false);
});

test('GET /api/documents - rejects a non-positive limit', async () => {
  const res = await request(app).get('/api/documents?limit=0');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_LIMIT');
});

test('GET /api/documents - rejects a negative offset', async () => {
  const res = await request(app).get('/api/documents?limit=5&offset=-1');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_OFFSET');
});

test('GET /api/conversations - with no limit/offset, unchanged default behavior', async (t) => {
  let receivedOptions;
  t.mock.method(conversationStore, 'listConversations', async (options) => {
    receivedOptions = options;
    return [];
  });
  const res = await request(app).get('/api/conversations');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(receivedOptions.limit, undefined);
  assert.strictEqual(res.body.hasMore, undefined);
});

test('GET /api/conversations - with ?limit=&offset=, pages through correctly', async (t) => {
  let receivedOptions;
  t.mock.method(conversationStore, 'listConversations', async (options) => {
    receivedOptions = options;
    return [{ id: 'c1', title: 'x', updatedAt: 'now' }];
  });
  const res = await request(app).get('/api/conversations?limit=1&offset=3');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(receivedOptions.limit, 1);
  assert.strictEqual(receivedOptions.offset, 3);
  assert.strictEqual(res.body.hasMore, true);
});
