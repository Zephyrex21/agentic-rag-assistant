const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const rag = require('../src/services/rag');
const app = require('../src/app');

/** Parses a raw `event: X\ndata: {...}\n\n` SSE body into a simple array of
 * {event, data} objects, so tests can assert on it without hand-rolling
 * the same parsing logic in every test. */
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

test('POST /api/query - rejects a missing question', async () => {
  const res = await request(app).post('/api/query').send({});
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_QUESTION');
});

test('POST /api/query - rejects a whitespace-only question', async () => {
  const res = await request(app).post('/api/query').send({ question: '   ' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MISSING_QUESTION');
});

test('POST /api/query - streams sources, chunks, and a final done event', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'sources', sources: [{ sourceNumber: 1, filename: 'readme.md' }] };
    yield { type: 'chunk', text: 'Hello ' };
    yield { type: 'chunk', text: 'world.' };
    yield { type: 'done', answer: 'Hello world.', sources: [], verified: true, wasRevised: false };
  });

  const res = await request(app).post('/api/query').send({ question: 'What is this?' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['content-type'], 'text/event-stream');

  const events = parseSse(res.text);
  assert.strictEqual(events[0].event, 'sources');
  assert.strictEqual(events[1].event, 'chunk');
  assert.strictEqual(events[1].data.text, 'Hello ');
  const doneEvent = events.find((e) => e.event === 'done');
  assert.ok(doneEvent, 'expected a done event');
  assert.strictEqual(doneEvent.data.answer, 'Hello world.');
  assert.ok(doneEvent.data.queryId); // random per-query id, just needs to exist
});

test('POST /api/query - a mid-stream failure is sent as an error event, not a hung connection', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'chunk', text: 'partial answer' };
    throw new Error('Groq unreachable');
  });

  const res = await request(app).post('/api/query').send({ question: 'Anything' });
  const events = parseSse(res.text);
  const errorEvent = events.find((e) => e.event === 'error');
  assert.ok(errorEvent, 'expected an error event');
  assert.match(errorEvent.data.message, /Groq unreachable/);
});

test('POST /api/query - surfaces the "not enough info" case correctly', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield {
      type: 'no_info',
      answer: "I don't have enough relevant information in the uploaded documents to answer that.",
    };
  });

  const res = await request(app).post('/api/query').send({ question: 'Unrelated question' });
  const events = parseSse(res.text);
  const chunkEvent = events.find((e) => e.event === 'chunk');
  assert.match(chunkEvent.data.text, /don't have enough/);
});

test('POST /api/query - done arrives with verified:null and is followed by a verified event once the background check passes', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'chunk', text: 'The answer.' };
    yield { type: 'done', answer: 'The answer.', sources: [], verified: null, wasRevised: false, trace: { stages: [] } };
    yield { type: 'verified', verified: true, trace: { stages: ['verification'] } };
  });

  const res = await request(app).post('/api/query').send({ question: 'What is this?' });
  const events = parseSse(res.text);

  const doneEvent = events.find((e) => e.event === 'done');
  assert.strictEqual(doneEvent.data.verified, null, 'done should carry the pending (null) verified state, not a guessed value');
  assert.strictEqual(doneEvent.data.answer, 'The answer.', 'the answer at done time is already final');

  const verifiedEvent = events.find((e) => e.event === 'verified');
  assert.ok(verifiedEvent, 'expected a separate verified event after done');
  assert.strictEqual(verifiedEvent.data.verified, true);
});

test('POST /api/query - forwards a revision_available event as a suggestion, without altering the already-sent done event', async (t) => {
  t.mock.method(rag, 'retrieveAndAnswerStream', async function* () {
    yield { type: 'chunk', text: 'Original answer.' };
    yield { type: 'done', answer: 'Original answer.', sources: [{ sourceNumber: 1 }], verified: null, wasRevised: false };
    yield {
      type: 'revision_available',
      suggestedAnswer: 'Corrected answer.',
      suggestedSources: [{ sourceNumber: 1 }, { sourceNumber: 2 }],
      suggestedVerified: true,
      issue: 'A number was not supported by the sources.',
      trace: { stages: [] },
    };
  });

  const res = await request(app).post('/api/query').send({ question: 'What is this?' });
  const events = parseSse(res.text);

  const doneEvent = events.find((e) => e.event === 'done');
  assert.strictEqual(doneEvent.data.answer, 'Original answer.', 'the original answer must stay exactly as sent - never mutated by a later suggestion');

  const revisionEvent = events.find((e) => e.event === 'revision_available');
  assert.ok(revisionEvent, 'expected a revision_available event');
  assert.strictEqual(revisionEvent.data.suggestedAnswer, 'Corrected answer.');
  assert.strictEqual(revisionEvent.data.issue, 'A number was not supported by the sources.');
});
