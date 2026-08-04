const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

// Dummy env so app.js/routes can boot (no real network calls happen since
// every DB/service call below is mocked before the app is ever required).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const documentStore = require('../src/db/documentStore');
const chunkStore = require('../src/db/chunkStore');
const pinecone = require('../src/services/pinecone');
const ingestionWorker = require('../src/workers/ingestionWorker');
const app = require('../src/app');

// Route handlers call these as documentStore.list(...), not a destructured
// reference - so re-mocking per test with t.mock.method (auto-restored
// after each test) correctly affects what the route sees on every call,
// unlike the streaming routes (see query.test.js) where the equivalent
// dependency IS destructured at require time.

test('POST /api/documents/upload - rejects when no file is attached', async () => {
  const res = await request(app).post('/api/documents/upload');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'NO_FILE');
});

test('POST /api/documents/upload - rejects an unsupported file type', async () => {
  const res = await request(app)
    .post('/api/documents/upload')
    .attach('file', Buffer.from('binary junk'), 'archive.zip');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'UNSUPPORTED_FILE_TYPE');
});

test('POST /api/documents/upload - accepts a supported file and starts ingestion', async (t) => {
  t.mock.method(documentStore, 'create', async (doc) => doc);
  t.mock.method(ingestionWorker, 'processDocument', () => {}); // fire-and-forget, never awaited by the route

  const res = await request(app)
    .post('/api/documents/upload')
    .attach('file', Buffer.from('hello world'), 'notes.txt');

  assert.strictEqual(res.status, 202);
  assert.strictEqual(res.body.filename, 'notes.txt');
  assert.strictEqual(res.body.status, 'processing');
  assert.ok(res.body.documentId);
  assert.strictEqual(documentStore.create.mock.calls.length, 1);
});

test('POST /api/documents/upload - passes an optional folderId through to the store', async (t) => {
  let capturedDoc;
  t.mock.method(documentStore, 'create', async (doc) => {
    capturedDoc = doc;
    return doc;
  });
  t.mock.method(ingestionWorker, 'processDocument', () => {});

  await request(app)
    .post('/api/documents/upload')
    .field('folderId', 'folder-123')
    .attach('file', Buffer.from('hello'), 'notes.txt');

  assert.strictEqual(capturedDoc.folderId, 'folder-123');
});

test('POST /api/documents/upload - a DB failure becomes a clean 500, not a crash', async (t) => {
  t.mock.method(documentStore, 'create', async () => {
    throw new Error('connection refused');
  });

  const res = await request(app)
    .post('/api/documents/upload')
    .attach('file', Buffer.from('hello'), 'notes.txt');

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error.code, 'UPLOAD_FAILED');
});

test('GET /api/documents/:id/status - returns the current status', async (t) => {
  t.mock.method(documentStore, 'get', async () => ({
    id: 'd1',
    status: 'ready',
    chunkCount: 12,
    error: null,
  }));

  const res = await request(app).get('/api/documents/d1/status');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ready');
  assert.strictEqual(res.body.chunkCount, 12);
});

test('GET /api/documents/:id/status - 404s for an unknown document', async (t) => {
  t.mock.method(documentStore, 'get', async () => null);
  const res = await request(app).get('/api/documents/does-not-exist/status');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'DOCUMENT_NOT_FOUND');
});

test('GET /api/documents - lists all documents by default', async (t) => {
  t.mock.method(documentStore, 'list', async (options) => {
    assert.deepStrictEqual(options, {}); // no folder filter applied
    return [{ id: 'd1', filename: 'a.pdf', status: 'ready', chunkCount: 3, uploadedAt: 'now', folderId: null }];
  });

  const res = await request(app).get('/api/documents');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.documents.length, 1);
});

test('GET /api/documents?folderId=none - filters to uncategorized documents', async (t) => {
  t.mock.method(documentStore, 'list', async (options) => {
    assert.strictEqual(options.folderId, null);
    return [];
  });
  const res = await request(app).get('/api/documents?folderId=none');
  assert.strictEqual(res.status, 200);
});

test('GET /api/documents?folderId=<id> - filters to a specific folder', async (t) => {
  t.mock.method(documentStore, 'list', async (options) => {
    assert.strictEqual(options.folderId, 'folder-abc');
    return [];
  });
  const res = await request(app).get('/api/documents?folderId=folder-abc');
  assert.strictEqual(res.status, 200);
});

test('PATCH /api/documents/:id/folder - moves a document to a folder', async (t) => {
  t.mock.method(documentStore, 'get', async () => ({ id: 'd1' }));
  t.mock.method(documentStore, 'moveToFolder', async (id, folderId) => ({ id, folderId }));

  const res = await request(app).patch('/api/documents/d1/folder').send({ folderId: 'folder-xyz' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.folderId, 'folder-xyz');
});

test('PATCH /api/documents/:id/folder - 404s for an unknown document', async (t) => {
  t.mock.method(documentStore, 'get', async () => null);
  const res = await request(app).patch('/api/documents/nope/folder').send({ folderId: 'x' });
  assert.strictEqual(res.status, 404);
});

test('DELETE /api/documents/:id - removes the document and its vectors', async (t) => {
  t.mock.method(documentStore, 'get', async () => ({ id: 'd1', chunkCount: 4 }));
  t.mock.method(pinecone, 'deleteByDocumentId', async () => {});
  t.mock.method(chunkStore, 'deleteByDocumentId', async () => {});
  t.mock.method(documentStore, 'remove', async () => true);

  const res = await request(app).delete('/api/documents/d1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('DELETE /api/documents/:id - 404s for an unknown document', async (t) => {
  t.mock.method(documentStore, 'get', async () => null);
  const res = await request(app).delete('/api/documents/nope');
  assert.strictEqual(res.status, 404);
});

test('DELETE /api/documents/:id - still succeeds if Pinecone cleanup fails (graceful degradation)', async (t) => {
  // This is the exact resilience behavior documented in documents.js: a
  // Pinecone failure during delete should not block removing the document
  // record itself - it's caught and logged, not re-thrown.
  t.mock.method(documentStore, 'get', async () => ({ id: 'd1', chunkCount: 4 }));
  t.mock.method(pinecone, 'deleteByDocumentId', async () => {
    throw new Error('Pinecone unreachable');
  });
  t.mock.method(chunkStore, 'deleteByDocumentId', async () => {});
  t.mock.method(documentStore, 'remove', async () => true);

  const res = await request(app).delete('/api/documents/d1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(documentStore.remove.mock.calls.length, 1); // cleanup still ran
});
