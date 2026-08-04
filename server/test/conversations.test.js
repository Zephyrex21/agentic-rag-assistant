const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const conversationStore = require('../src/db/conversationStore');
const rag = require('../src/services/rag');
const app = require('../src/app');

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

test('POST /api/conversations - creates a new thread', async (t) => {
  t.mock.method(conversationStore, 'createConversation', async () => ({ id: 'c1', title: 'New conversation' }));
  const res = await request(app).post('/api/conversations');
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.conversationId, 'c1');
});

test('GET /api/conversations - lists threads', async (t) => {
  t.mock.method(conversationStore, 'listConversations', async () => [
    { id: 'c1', title: 'First chat', updatedAt: 'now' },
  ]);
  const res = await request(app).get('/api/conversations');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.conversations.length, 1);
});

test('GET /api/conversations/:id - returns the full thread', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({
    id: 'c1',
    title: 'First chat',
    messages: [{ id: 'm1', role: 'user', content: 'Hi' }],
  }));
  const res = await request(app).get('/api/conversations/c1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.messages.length, 1);
});

test('GET /api/conversations/:id - 404s for an unknown thread', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => null);
  const res = await request(app).get('/api/conversations/nope');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'CONVERSATION_NOT_FOUND');
});

test('DELETE /api/conversations/:id - deletes a thread', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'x', messages: [] }));
  t.mock.method(conversationStore, 'deleteConversation', async () => true);
  const res = await request(app).delete('/api/conversations/c1');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

test('DELETE /api/conversations/:id - 404s for an unknown thread', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => null);
  const res = await request(app).delete('/api/conversations/nope');
  assert.strictEqual(res.status, 404);
});

test('POST /api/conversations/:id/messages - rejects a missing question before any DB lookup', async (t) => {
  t.mock.method(conversationStore, 'getConversation', () => {
    throw new Error('should not be called - validation must short-circuit first');
  });
  const res = await request(app).post('/api/conversations/c1/messages').send({});
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_QUESTION');
});

test('POST /api/conversations/:id/messages - 404s for an unknown conversation', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => null);
  const res = await request(app).post('/api/conversations/nope/messages').send({ question: 'Hi' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'CONVERSATION_NOT_FOUND');
});

test('POST /api/conversations/:id/messages - streams an answer and persists it', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({
    id: 'c1',
    title: 'New conversation',
    messages: [], // first message in the thread - relevant for the title-update test below
  }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => ({ id: 'm-new', ...msg }));
  t.mock.method(conversationStore, 'updateTitle', async () => {});
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'chunk', text: 'The answer.' };
    yield { type: 'done', answer: 'The answer.', sources: [], verified: true, wasRevised: false };
  });

  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'What is this about?' });

  assert.strictEqual(res.status, 200);
  const events = parseSse(res.text);
  const doneEvent = events.find((e) => e.event === 'done');
  assert.ok(doneEvent);
  assert.strictEqual(doneEvent.data.answer, 'The answer.');

  // Both the user's question AND the assistant's answer should be persisted.
  assert.strictEqual(conversationStore.addMessage.mock.calls.length, 2);
  const roles = conversationStore.addMessage.mock.calls.map((c) => c.arguments[1].role);
  assert.deepStrictEqual(roles, ['user', 'assistant']);

  // First message in a still-untitled thread -> auto-title should fire.
  assert.strictEqual(conversationStore.updateTitle.mock.calls.length, 1);
});

test('POST /api/conversations/:id/messages - does NOT re-title a thread that already has messages', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({
    id: 'c1',
    title: 'New conversation',
    messages: [{ id: 'm0', role: 'user', content: 'earlier message' }], // NOT the first message
  }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => ({ id: 'm-new', ...msg }));
  t.mock.method(conversationStore, 'updateTitle', async () => {});
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'done', answer: 'Answer.', sources: [], verified: true, wasRevised: false };
  });

  await request(app).post('/api/conversations/c1/messages').send({ question: 'A follow-up question' });

  assert.strictEqual(conversationStore.updateTitle.mock.calls.length, 0);
});
