const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const embeddings = require('../src/services/embeddings');
const pinecone = require('../src/services/pinecone');
const answerCacheStore = require('../src/db/answerCacheStore');
const answerCache = require('../src/services/answerCache');

function mockEmbedOne(t, vector = [0.1, 0.2, 0.3]) {
  return t.mock.method(embeddings, 'embedOne', async () => vector);
}

// --- Pure helpers - no mocking needed ---

test('buildOwnerKey - "guest" for a null/undefined userId, the real id otherwise', () => {
  assert.strictEqual(answerCache.buildOwnerKey(null), 'guest');
  assert.strictEqual(answerCache.buildOwnerKey(undefined), 'guest');
  assert.strictEqual(answerCache.buildOwnerKey('user-42'), 'user-42');
});

test('buildDocSignature - "ALL" for no scope, sorted+joined otherwise so order never matters', () => {
  assert.strictEqual(answerCache.buildDocSignature(undefined), 'ALL');
  assert.strictEqual(answerCache.buildDocSignature([]), 'ALL');
  assert.strictEqual(answerCache.buildDocSignature(['doc-b', 'doc-a']), 'doc-a,doc-b');
  assert.strictEqual(answerCache.buildDocSignature(['doc-a', 'doc-b']), 'doc-a,doc-b');
});

test('extractDistinguishingTokens - picks up numbers and code-like identifiers, ignores ordinary words', () => {
  const tokens = answerCache.extractDistinguishingTokens('What is the accuracy of E5 compared to E6 in 2024?');
  assert.ok(tokens.has('E5'));
  assert.ok(tokens.has('E6'));
  assert.ok(tokens.has('2024'));
  assert.ok(!tokens.has('WHAT'));
  assert.ok(!tokens.has('ACCURACY'));
});

test('tokensMatch - the exact E5-vs-E6 failure mode this exists to catch', () => {
  assert.strictEqual(answerCache.tokensMatch('what is the accuracy of E5?', 'what is the accuracy of E6?'), false);
  assert.strictEqual(answerCache.tokensMatch('what is the accuracy of E5?', 'what is the accuracy of E5?'), true);
  // Neither question has any distinguishing tokens at all - nothing for
  // this check to add, so it must not block an otherwise-good match.
  assert.strictEqual(answerCache.tokensMatch('what is this document about?', 'what is this paper about?'), true);
});

// --- lookup() ---

test('lookup - returns null (a plain miss) when nothing is above the similarity threshold', async (t) => {
  mockEmbedOne(t);
  t.mock.method(pinecone, 'queryVectors', async () => []);

  const result = await answerCache.lookup({ question: 'What is this about?', userId: null, documentIds: undefined });
  assert.strictEqual(result, null);
});

test('lookup - returns null when the best match score is below SIMILARITY_THRESHOLD', async (t) => {
  mockEmbedOne(t);
  t.mock.method(pinecone, 'queryVectors', async () => [{ id: 'cache-1', score: answerCache.SIMILARITY_THRESHOLD - 0.05 }]);
  t.mock.method(answerCacheStore, 'findById', async () => {
    throw new Error('FAIL: should never even look up the row for a below-threshold match');
  });

  const result = await answerCache.lookup({ question: 'anything', userId: null, documentIds: undefined });
  assert.strictEqual(result, null);
});

test('lookup - a confident match returns the cached answer and scopes the Pinecone query by owner + doc signature', async (t) => {
  mockEmbedOne(t);
  let capturedFilter = null;
  let capturedNamespace = null;
  t.mock.method(pinecone, 'queryVectors', async (_vector, _topK, filter, namespace) => {
    capturedFilter = filter;
    capturedNamespace = namespace;
    return [{ id: 'cache-1', score: 0.97 }];
  });
  t.mock.method(answerCacheStore, 'findById', async (id) => ({
    id,
    question: 'What is this document about?',
    answer: 'It is about fuzzy logic tuning.',
    sources: [{ number: 1, documentName: 'paper.pdf' }],
    hitCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
  }));
  t.mock.method(answerCacheStore, 'recordHit', async () => {});

  const result = await answerCache.lookup({ question: 'What is this document about?', userId: 'user-1', documentIds: ['doc-a'] });
  assert.ok(result);
  assert.strictEqual(result.answer, 'It is about fuzzy logic tuning.');
  assert.strictEqual(result.similarity, 0.97);
  assert.strictEqual(result.hitCount, 3); // cached.hitCount (2) + 1 for this hit
  assert.deepStrictEqual(capturedFilter, { ownerKey: { $eq: 'user-1' }, docSignature: { $eq: 'doc-a' } });
  assert.strictEqual(capturedNamespace, 'answer-cache');
});

test('lookup - rejects a high-similarity match whose distinguishing tokens differ (the E5-vs-E6 case)', async (t) => {
  mockEmbedOne(t);
  t.mock.method(pinecone, 'queryVectors', async () => [{ id: 'cache-1', score: 0.98 }]);
  t.mock.method(answerCacheStore, 'findById', async () => ({
    id: 'cache-1',
    question: 'What is the accuracy of E5?',
    answer: 'E5 achieved an MSE of 0.094.',
    sources: [],
    hitCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
  }));
  let hitRecorded = false;
  t.mock.method(answerCacheStore, 'recordHit', async () => {
    hitRecorded = true;
  });

  const result = await answerCache.lookup({ question: 'What is the accuracy of E6?', userId: null, documentIds: undefined });
  assert.strictEqual(result, null, 'FAIL: a token mismatch must reject the match even at very high embedding similarity');
  assert.strictEqual(hitRecorded, false, 'FAIL: a rejected match must not be recorded as a hit');
});

test('lookup - a dangling Pinecone match (no matching Postgres row) is treated as a miss, not an error', async (t) => {
  mockEmbedOne(t);
  t.mock.method(pinecone, 'queryVectors', async () => [{ id: 'deleted-row-id', score: 0.99 }]);
  t.mock.method(answerCacheStore, 'findById', async () => null);

  const result = await answerCache.lookup({ question: 'anything', userId: null, documentIds: undefined });
  assert.strictEqual(result, null);
});

test('lookup - never throws even if a dependency does (a cache failure must never block a real answer)', async (t) => {
  t.mock.method(embeddings, 'embedOne', async () => {
    throw new Error('Jina is down');
  });

  const result = await answerCache.lookup({ question: 'anything', userId: null, documentIds: undefined });
  assert.strictEqual(result, null);
});

// --- write() ---

test('write - inserts the Postgres row first, then upserts a Pinecone vector using that row\'s id, into the answer-cache namespace', async (t) => {
  mockEmbedOne(t, [0.4, 0.5, 0.6]);
  let insertedArgs = null;
  t.mock.method(answerCacheStore, 'insert', async (args) => {
    insertedArgs = args;
    return 'new-cache-id';
  });
  let upsertedVectors = null;
  let upsertedNamespace = null;
  t.mock.method(pinecone, 'upsertVectors', async (vectors, namespace) => {
    upsertedVectors = vectors;
    upsertedNamespace = namespace;
  });

  await answerCache.write({
    question: 'What is this about?',
    answer: 'It is about X.',
    sources: [{ number: 1 }],
    userId: 'user-1',
    documentIds: ['doc-a', 'doc-b'],
  });

  assert.strictEqual(insertedArgs.ownerKey, 'user-1');
  assert.strictEqual(insertedArgs.docSignature, 'doc-a,doc-b');
  assert.strictEqual(insertedArgs.question, 'What is this about?');
  assert.strictEqual(upsertedNamespace, 'answer-cache');
  assert.strictEqual(upsertedVectors[0].id, 'new-cache-id');
  assert.deepStrictEqual(upsertedVectors[0].values, [0.4, 0.5, 0.6]);
  assert.deepStrictEqual(upsertedVectors[0].metadata, { ownerKey: 'user-1', docSignature: 'doc-a,doc-b' });
});

test('write - never throws even if a dependency does (caching is best-effort, never the reason a response fails)', async (t) => {
  t.mock.method(answerCacheStore, 'insert', async () => {
    throw new Error('DB is down');
  });

  await assert.doesNotReject(() =>
    answerCache.write({ question: 'x', answer: 'y', sources: [], userId: null, documentIds: undefined })
  );
});

// --- Regression: zero-source answers must never be cached or served ---
// Real bug: the planner skipped the search for "tell me about this
// document", producing a zero-source "I don't have any documents" answer.
// verifyAnswer passes any answer with no sources, so it was written to the
// cache and then replayed for every later near-identical question - even
// after the planner itself behaved.

test('write - never caches an answer that has no sources (it was never grounded in the documents)', async (t) => {
  mockEmbedOne(t);
  const insertMock = t.mock.method(answerCacheStore, 'insert', async () => 'should-not-happen');
  const upsertMock = t.mock.method(pinecone, 'upsertVectors', async () => {});

  await answerCache.write({ question: 'tell me about this document', answer: "I don't have any documents to refer to.", sources: [], userId: null, documentIds: ['doc-a'] });
  await answerCache.write({ question: 'tell me about this document', answer: 'x', sources: undefined, userId: null, documentIds: ['doc-a'] });

  assert.strictEqual(insertMock.mock.callCount(), 0, 'a zero-source answer must not reach the database');
  assert.strictEqual(upsertMock.mock.callCount(), 0, 'a zero-source answer must not reach Pinecone');
});

test('lookup - ignores an already-saved zero-source row, so previously poisoned entries heal themselves', async (t) => {
  mockEmbedOne(t);
  t.mock.method(pinecone, 'queryVectors', async () => [{ id: 'poisoned-1', score: 1 }]);
  t.mock.method(answerCacheStore, 'findById', async (id) => ({
    id,
    question: 'tell me about this document',
    answer: "I'm sorry, but I don't have any information about that document.",
    sources: [],
    hitCount: 3,
    createdAt: '2026-10-01T00:00:00Z',
  }));
  const hitMock = t.mock.method(answerCacheStore, 'recordHit', async () => {});

  const result = await answerCache.lookup({ question: 'tell me about this document', userId: null, documentIds: ['doc-a'] });
  assert.strictEqual(result, null, 'must be a miss so the real pipeline runs');
  assert.strictEqual(hitMock.mock.callCount(), 0, 'a skipped row must not be counted as a hit');
});
