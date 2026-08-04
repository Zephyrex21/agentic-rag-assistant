const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const folderStore = require('../src/db/folderStore');
const app = require('../src/app');

test('GET /api/folders - lists folders', async (t) => {
  t.mock.method(folderStore, 'list', async () => [{ id: 'f1', name: 'Research', createdAt: 'now' }]);
  const res = await request(app).get('/api/folders');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.folders.length, 1);
  assert.strictEqual(res.body.folders[0].name, 'Research');
});

test('POST /api/folders - creates a folder', async (t) => {
  t.mock.method(folderStore, 'create', async (name) => ({ id: 'f2', name, createdAt: 'now' }));
  const res = await request(app).post('/api/folders').send({ name: 'Case Files' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.folder.name, 'Case Files');
});

test('POST /api/folders - rejects an empty name', async (t) => {
  const res = await request(app).post('/api/folders').send({ name: '' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_NAME');
});

test('POST /api/folders - rejects a whitespace-only name', async () => {
  const res = await request(app).post('/api/folders').send({ name: '   ' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_NAME');
});

test('POST /api/folders - rejects a name over 100 characters', async () => {
  const res = await request(app)
    .post('/api/folders')
    .send({ name: 'x'.repeat(101) });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'NAME_TOO_LONG');
});

test('POST /api/folders - trims surrounding whitespace before validating/storing', async (t) => {
  let captured;
  t.mock.method(folderStore, 'create', async (name) => {
    captured = name;
    return { id: 'f3', name, createdAt: 'now' };
  });
  const res = await request(app).post('/api/folders').send({ name: '  Evidence  ' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(captured, 'Evidence');
});

test('DELETE /api/folders/:id - deletes a folder (documents are uncategorized by the DB, not deleted)', async (t) => {
  t.mock.method(folderStore, 'remove', async () => true);
  const res = await request(app).delete('/api/folders/f1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('DELETE /api/folders/:id - a store failure becomes a clean 500', async (t) => {
  t.mock.method(folderStore, 'remove', async () => {
    throw new Error('db unreachable');
  });
  const res = await request(app).delete('/api/folders/f1');
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error.code, 'DELETE_FAILED');
});
