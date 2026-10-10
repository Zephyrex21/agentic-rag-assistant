const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const rag = require('../src/services/rag');
const answerCache = require('../src/services/answerCache');

async function collect(generator) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

test('retrieveAndAnswerStream - a cache hit short-circuits: yields sources/chunk/done and touches nothing else in the pipeline', async (t) => {
  t.mock.method(answerCache, 'lookup', async ({ question, userId, documentIds }) => {
    assert.strictEqual(question, 'What is this about?');
    assert.strictEqual(userId, 'user-1');
    assert.deepStrictEqual(documentIds, ['doc-a']);
    return {
      answer: 'It is about fuzzy logic tuning.',
      sources: [{ number: 1, documentName: 'paper.pdf' }],
      similarity: 0.97,
      hitCount: 4,
      cachedQuestion: 'What is this document about?',
      createdAt: '2026-01-01T00:00:00Z',
    };
  });
  // If a cache hit didn't actually short-circuit, execution would reach
  // this and either throw (dummy Pinecone/Groq creds) or hang - so a
  // clean, fast set of exactly the three expected events is itself strong
  // evidence the rest of the pipeline never ran.
  const writeSpy = t.mock.method(answerCache, 'write', async () => {});

  const events = await collect(rag.retrieveAndAnswerStream('What is this about?', { userId: 'user-1', documentIds: ['doc-a'] }));

  assert.deepStrictEqual(
    events.map((e) => e.type),
    ['sources', 'chunk', 'done']
  );
  assert.strictEqual(events[0].sources[0].documentName, 'paper.pdf');
  assert.strictEqual(events[1].text, 'It is about fuzzy logic tuning.');
  assert.strictEqual(events[2].verified, true);
  assert.strictEqual(events[2].wasRevised, false);
  assert.strictEqual(events[2].trace.cacheHit, true);
  assert.strictEqual(events[2].trace.stages[0].key, 'cache');
  assert.strictEqual(events[2].trace.stages[0].data.similarity, 0.97);
  assert.strictEqual(events[2].trace.stages[0].data.hitCount, 4);
  // A hit is a reuse of an already-cached (already-verified-at-write-time)
  // answer - nothing new to write back for the same question.
  assert.strictEqual(writeSpy.mock.callCount(), 0);
});

test('retrieveAndAnswerStream - a cache miss falls through to the real pipeline (proven by reaching past the cache gate)', async (t) => {
  let lookupCalledWith = null;
  t.mock.method(answerCache, 'lookup', async (args) => {
    lookupCalledWith = args;
    return null; // miss
  });

  // With dummy Pinecone/Groq credentials, the real pipeline downstream of
  // the cache gate will fail - which is exactly the point here: reaching
  // that failure (instead of returning a clean cache-shaped result) is
  // what proves the miss path was actually taken, not short-circuited.
  const events = [];
  try {
    for await (const event of rag.retrieveAndAnswerStream('a brand new question', { userId: null, documentIds: undefined })) {
      events.push(event);
    }
  } catch {
    // Expected in this environment - see comment above.
  }

  assert.ok(lookupCalledWith, 'FAIL: expected the cache to be checked before anything else');
  assert.strictEqual(lookupCalledWith.question, 'a brand new question');
  assert.strictEqual(lookupCalledWith.userId, null);
  // Whatever DID come back, it must not be the cache-hit shape.
  assert.ok(!events.some((e) => e.trace?.cacheHit === true));
});

test('retrieveAndAnswerStream - ENABLE_ANSWER_CACHE=false skips the cache check entirely', async (t) => {
  const originalEnv = process.env.ENABLE_ANSWER_CACHE;
  process.env.ENABLE_ANSWER_CACHE = 'false';
  // Force a fresh require so the module re-reads the env var - rag.js
  // reads ENABLE_ANSWER_CACHE once at module load, same as every other
  // ENABLE_* flag in that file.
  delete require.cache[require.resolve('../src/services/rag')];
  const ragFresh = require('../src/services/rag');

  const lookupSpy = t.mock.method(answerCache, 'lookup', async () => {
    throw new Error('FAIL: should never be called when the flag is off');
  });

  try {
    for await (const _event of ragFresh.retrieveAndAnswerStream('anything', {})) {
      // Draining is enough - we only care whether lookup() was reached.
    }
  } catch {
    // The real pipeline will fail against dummy credentials - expected,
    // and irrelevant to what this test checks.
  }

  assert.strictEqual(lookupSpy.mock.callCount(), 0);

  if (originalEnv === undefined) delete process.env.ENABLE_ANSWER_CACHE;
  else process.env.ENABLE_ANSWER_CACHE = originalEnv;
  delete require.cache[require.resolve('../src/services/rag')];
});
