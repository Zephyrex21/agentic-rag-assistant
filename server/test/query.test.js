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
