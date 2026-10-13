const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const documentStore = require('../src/db/documentStore');
const conversationStore = require('../src/db/conversationStore');
const folderStore = require('../src/db/folderStore');
const rag = require('../src/services/rag');
const app = require('../src/app');

// What a paused / unreachable Supabase looked like in production.
const FETCH_FAILED = 'documentStore.list failed: TypeError: fetch failed';
const LEAK_RE = /TypeError|fetch failed|supabase|org_|openai\/|gpt-oss|tokens per minute|getaddrinfo|ENOTFOUND|\bStore\b|documentStore|conversationStore|folderStore/i;

function parseSse(rawBody) {
  return rawBody
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const eventMatch = block.match(/^event: (.+)$/m);
      const dataMatch = block.match(/^data: (.+)$/m);
      return { event: eventMatch?.[1], data: dataMatch ? JSON.parse(dataMatch[1]) : undefined };
    });
}

// ---------- the exact failures from the production screenshots ----------

test('GET /api/documents - an unreachable database is a friendly 503, not "TypeError: fetch failed"', async (t) => {
  t.mock.method(documentStore, 'list', async () => {
    throw new Error(FETCH_FAILED);
  });
  const res = await request(app).get('/api/documents');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.match(res.body.error.message, /temporarily unreachable/i);
  assert.doesNotMatch(res.body.error.message, LEAK_RE);
});

test('GET /api/conversations - same friendly 503 for the conversations list', async (t) => {
  t.mock.method(conversationStore, 'listConversations', async () => {
    throw new Error('conversationStore.listConversations failed: TypeError: fetch failed');
  });
  const res = await request(app).get('/api/conversations');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(res.body.error.message, LEAK_RE);
});

test('GET /api/folders - same for folders', async (t) => {
  t.mock.method(folderStore, 'list', async () => {
    throw new Error('folderStore.list failed: TypeError: fetch failed');
  });
  const res = await request(app).get('/api/folders');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.error.code, 'SERVICE_UNAVAILABLE');
});

// ---------- ordinary (unrecognised) failures keep their contract ----------

test('an ordinary store failure keeps its own error code and a 500, but never echoes the raw message', async (t) => {
  t.mock.method(documentStore, 'list', async () => {
    throw new Error('documentStore.list failed: relation "documents" does not exist');
  });
  const res = await request(app).get('/api/documents');
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error.code, 'LIST_FAILED');
  assert.strictEqual(res.body.error.message, "Couldn't load your documents. Please try again.");
  assert.doesNotMatch(res.body.error.message, /relation|documents" does not/);
});

test('each route keeps a clear, specific fallback sentence (not one generic message)', async (t) => {
  t.mock.method(folderStore, 'create', async () => {
    throw new Error('boom');
  });
  const folder = await request(app).post('/api/folders').send({ name: 'Case Files' });
  assert.strictEqual(folder.body.error.code, 'CREATE_FAILED');
  assert.strictEqual(folder.body.error.message, "Couldn't create that folder. Please try again.");

  t.mock.method(conversationStore, 'createConversation', async () => {
    throw new Error('boom');
  });
  const convo = await request(app).post('/api/conversations');
  assert.strictEqual(convo.body.error.code, 'CREATE_FAILED');
  assert.strictEqual(convo.body.error.message, "Couldn't start a new conversation. Please try again.");
});

test('deliberate client errors (400/404) are untouched', async (t) => {
  const missing = await request(app).post('/api/folders').send({ name: '' });
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.body.error.code, 'MISSING_NAME');
  assert.strictEqual(missing.body.error.message, 'Request body must include a non-empty "name" string.');

  t.mock.method(conversationStore, 'getConversation', async () => null);
  const notFound = await request(app).get('/api/conversations/nope');
  assert.strictEqual(notFound.status, 404);
  assert.strictEqual(notFound.body.error.code, 'CONVERSATION_NOT_FOUND');
});

// ---------- streaming (the error users actually see most) ----------

test('POST /api/query - a Groq rate limit mid-stream is a friendly "AI is busy", with no org id or token counts', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'chunk', text: 'partial' };
    throw new Error(
      'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01abc123def` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7200, Requested 2100.'
    );
  });
  const res = await request(app).post('/api/query').send({ question: 'Anything' });
  const errorEvent = parseSse(res.text).find((e) => e.event === 'error');
  assert.ok(errorEvent);
  assert.strictEqual(errorEvent.data.code, 'AI_BUSY');
  assert.match(errorEvent.data.message, /busy/i);
  assert.doesNotMatch(errorEvent.data.message, LEAK_RE);
});

test('POST /api/query - an unreachable provider mid-stream is a friendly "temporarily unreachable"', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    throw new Error('Connection error.');
  });
  const res = await request(app).post('/api/query').send({ question: 'Anything' });
  const errorEvent = parseSse(res.text).find((e) => e.event === 'error');
  assert.strictEqual(errorEvent.data.code, 'SERVICE_UNAVAILABLE');
  assert.match(errorEvent.data.message, /temporarily unreachable/i);
});

test('POST /api/query - an oversized request is a friendly "too large" message', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    throw new Error('Request too large for model `openai/gpt-oss-120b` ... tokens per minute (TPM): Limit 8000, Requested 9500');
  });
  const res = await request(app).post('/api/query').send({ question: 'Anything' });
  const errorEvent = parseSse(res.text).find((e) => e.event === 'error');
  assert.strictEqual(errorEvent.data.code, 'REQUEST_TOO_LARGE');
  assert.doesNotMatch(errorEvent.data.message, LEAK_RE);
});

test('POST /api/conversations/:id/messages - the conversation stream gets the same friendly errors', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'x', messages: [] }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => ({ id: 'm-new', ...msg }));
  t.mock.method(conversationStore, 'updateTitle', async () => {});
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    throw new Error('Rate limit reached ... tokens per minute (TPM) ...');
  });
  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'Hello there' });
  const errorEvent = parseSse(res.text).find((e) => e.event === 'error');
  assert.ok(errorEvent, 'expected an error event');
  assert.strictEqual(errorEvent.data.code, 'AI_BUSY');
  assert.doesNotMatch(errorEvent.data.message, LEAK_RE);
});

test('the conversation lookup failing before streaming starts is also friendly', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => {
    throw new Error('conversationStore.getConversation failed: TypeError: fetch failed');
  });
  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'Hello there' });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(res.body.error.message, LEAK_RE);
});

// ---------- the top-level handler ----------

test('a malformed JSON request body still gets a helpful 4xx message (framework-approved, so it is allowed through)', async () => {
  const res = await request(app).post('/api/folders').set('Content-Type', 'application/json').send('{"name": ');
  assert.strictEqual(res.status, 400);
  assert.ok(res.body.error.message.length > 0);
});
