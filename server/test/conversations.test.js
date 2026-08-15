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

test('POST /api/conversations/:id/messages - done persists the message with verified:null when verification is still pending', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'Existing chat', messages: [{ id: 'm0' }] }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  const addMessageCalls = [];
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => {
    addMessageCalls.push(msg);
    return { id: 'm-assistant', ...msg };
  });
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'done', answer: 'Original answer.', sources: [], verified: null, wasRevised: false, trace: null };
  });

  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'Anything' });

  const assistantSave = addMessageCalls.find((m) => m.role === 'assistant');
  assert.strictEqual(assistantSave.verified, null, 'the persisted message should record the pending state, not a guessed true/false');

  const events = parseSse(res.text);
  const doneEvent = events.find((e) => e.event === 'done');
  assert.strictEqual(doneEvent.data.messageId, 'm-assistant');
  assert.strictEqual(doneEvent.data.verified, null);
});

test('POST /api/conversations/:id/messages - a background verified event updates the already-persisted message', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'Existing chat', messages: [{ id: 'm0' }] }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => ({ id: 'm-assistant', ...msg }));
  const updateCalls = [];
  t.mock.method(conversationStore, 'updateMessage', async (messageId, updates) => {
    updateCalls.push({ messageId, updates });
    return { id: messageId, ...updates };
  });
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'done', answer: 'Original answer.', sources: [], verified: null, wasRevised: false };
    yield { type: 'verified', verified: true, trace: { stages: ['verification'] } };
  });

  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'Anything' });

  assert.strictEqual(updateCalls.length, 1);
  assert.strictEqual(updateCalls[0].messageId, 'm-assistant');
  assert.strictEqual(updateCalls[0].updates.verified, true);

  const events = parseSse(res.text);
  const verifiedEvent = events.find((e) => e.event === 'verified');
  assert.ok(verifiedEvent);
  assert.strictEqual(verifiedEvent.data.messageId, 'm-assistant');
});

test('POST /api/conversations/:id/messages - a revision_available event is forwarded WITHOUT writing anything to the DB', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'Existing chat', messages: [{ id: 'm0' }] }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (conversationId, msg) => ({ id: 'm-assistant', ...msg }));
  const updateMessageCalls = [];
  t.mock.method(conversationStore, 'updateMessage', async (messageId, updates) => {
    updateMessageCalls.push({ messageId, updates });
    return { id: messageId, ...updates };
  });
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'done', answer: 'Original answer.', sources: [], verified: null, wasRevised: false };
    yield {
      type: 'revision_available',
      suggestedAnswer: 'Corrected answer.',
      suggestedSources: [],
      suggestedVerified: true,
      issue: 'A date did not match the source.',
      trace: null,
    };
  });

  const res = await request(app).post('/api/conversations/c1/messages').send({ question: 'Anything' });

  assert.strictEqual(updateMessageCalls.length, 0, 'a suggestion must never be auto-persisted - only an explicit accept should write it');

  const events = parseSse(res.text);
  const revisionEvent = events.find((e) => e.event === 'revision_available');
  assert.ok(revisionEvent);
  assert.strictEqual(revisionEvent.data.messageId, 'm-assistant');
  assert.strictEqual(revisionEvent.data.suggestedAnswer, 'Corrected answer.');
});

test('PATCH /api/conversations/:id/messages/:messageId/revision - applies an accepted revision', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'Existing chat', messages: [] }));
  t.mock.method(conversationStore, 'updateMessage', async (messageId, updates) => ({ id: messageId, conversationId: 'c1', ...updates }));

  const res = await request(app)
    .patch('/api/conversations/c1/messages/m-assistant/revision')
    .send({ content: 'Corrected answer.', sources: [{ sourceNumber: 1 }], verified: true });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.content, 'Corrected answer.');
  assert.strictEqual(res.body.wasRevised, true);
  assert.strictEqual(conversationStore.updateMessage.mock.calls.length, 1);
  assert.strictEqual(conversationStore.updateMessage.mock.calls[0].arguments[0], 'm-assistant');
});

test('PATCH /api/conversations/:id/messages/:messageId/revision - rejects an empty content body', async (t) => {
  t.mock.method(conversationStore, 'getConversation', () => {
    throw new Error('should not be called - validation must short-circuit first');
  });
  const res = await request(app).patch('/api/conversations/c1/messages/m1/revision').send({ content: '' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_CONTENT');
});

test('PATCH /api/conversations/:id/messages/:messageId/revision - 404s for an unknown conversation', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => null);
  const res = await request(app).patch('/api/conversations/nope/messages/m1/revision').send({ content: 'Corrected.' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'CONVERSATION_NOT_FOUND');
});

test('PATCH /api/conversations/:id/messages/:messageId/revision - 404s for an unknown message', async (t) => {
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'x', messages: [] }));
  t.mock.method(conversationStore, 'updateMessage', async () => null);
  const res = await request(app).patch('/api/conversations/c1/messages/nope/revision').send({ content: 'Corrected.' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'MESSAGE_NOT_FOUND');
});
