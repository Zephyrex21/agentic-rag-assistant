const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const rag = require('../src/services/rag');
const conversationStore = require('../src/db/conversationStore');
const app = require('../src/app');
const { GUEST_QUERY_LIMIT, _resetForTests } = require('../src/middleware/guestQueryLimit');

function mockAnswer(t) {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'done', answer: 'An answer.', sources: [], verified: true, wasRevised: false };
  });
}

test.beforeEach(() => _resetForTests());

test('POST /api/query - a guest can ask up to GUEST_QUERY_LIMIT questions using the same cookie', async (t) => {
  mockAnswer(t);
  const agent = request.agent(app); // persists Set-Cookie across requests, unlike bare request(app)

  for (let i = 0; i < GUEST_QUERY_LIMIT; i += 1) {
    const res = await agent.post('/api/query').send({ question: `Question ${i}` });
    assert.strictEqual(res.status, 200, `FAIL: question ${i + 1} of ${GUEST_QUERY_LIMIT} should be allowed`);
  }
});

test('POST /api/query - a guest is blocked with GUEST_LIMIT_REACHED on the question after the limit', async (t) => {
  mockAnswer(t);
  const agent = request.agent(app);

  for (let i = 0; i < GUEST_QUERY_LIMIT; i += 1) {
    await agent.post('/api/query').send({ question: `Question ${i}` });
  }

  const res = await agent.post('/api/query').send({ question: 'One too many' });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.body.error.code, 'GUEST_LIMIT_REACHED');
});

test('POST /api/query - each guest is tracked independently (no shared/global counter)', async (t) => {
  mockAnswer(t);
  const agentA = request.agent(app);
  const agentB = request.agent(app);

  for (let i = 0; i < GUEST_QUERY_LIMIT; i += 1) {
    const res = await agentA.post('/api/query').send({ question: `A-${i}` });
    assert.strictEqual(res.status, 200);
  }
  // agentA is now exhausted, but agentB (a different guest cookie) should
  // still get its own full allowance.
  const resExhausted = await agentA.post('/api/query').send({ question: 'A over limit' });
  assert.strictEqual(resExhausted.status, 403);

  const resB = await agentB.post('/api/query').send({ question: 'B-0' });
  assert.strictEqual(resB.status, 200, "FAIL: a different guest's count must not be affected by agentA's usage");
});

test('POST /api/conversations/:id/messages - a signed-in user is never subject to the guest limit', async (t) => {
  mockAnswer(t);
  t.mock.method(conversationStore, 'getConversation', async () => ({ id: 'c1', title: 'x', messages: [{ id: 'm0' }] }));
  t.mock.method(conversationStore, 'getRecentMessages', async () => []);
  t.mock.method(conversationStore, 'addMessage', async (_id, msg) => ({ id: 'm-assistant', ...msg }));

  const { signToken } = require('../src/services/authTokens');
  const userStore = require('../src/db/userStore');
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'real@example.com' }));
  const token = signToken('user-1');

  const agent = request.agent(app);
  for (let i = 0; i < GUEST_QUERY_LIMIT + 3; i += 1) {
    const res = await agent
      .post('/api/conversations/c1/messages')
      .set('Cookie', `session=${token}`)
      .send({ question: `Question ${i}` });
    assert.strictEqual(res.status, 200, `FAIL: signed-in request ${i + 1} should never be limited`);
  }
});

test('GET /api/auth/me - reports guestQueriesRemaining for a guest and null for a signed-in user', async (t) => {
  mockAnswer(t);
  const agent = request.agent(app);

  const before = await agent.get('/api/auth/me');
  assert.strictEqual(before.body.guestQueriesRemaining, GUEST_QUERY_LIMIT);

  await agent.post('/api/query').send({ question: 'Uses one' });

  const after = await agent.get('/api/auth/me');
  assert.strictEqual(after.body.guestQueriesRemaining, GUEST_QUERY_LIMIT - 1);

  const { signToken } = require('../src/services/authTokens');
  const userStore = require('../src/db/userStore');
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'real@example.com' }));
  const token = signToken('user-1');
  const loggedIn = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);
  assert.strictEqual(loggedIn.body.guestQueriesRemaining, null);
});
