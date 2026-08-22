const test = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const documentStore = require('../src/db/documentStore');
const { annotateStaleCitations } = require('../src/db/conversationStore');

// Regression coverage for the fix: deleting a document used to leave every
// past conversation that cited it silently pointing at a documentId that
// no longer resolves to anything, with no way for the frontend to tell.
// annotateStaleCitations is called from conversationStore.getConversation
// on every read (not at delete time - see its own comment for why), which
// is exactly why it's tested here as a standalone unit rather than only
// through the (mocked-at-a-higher-level) route test in conversations.test.js.

test('annotateStaleCitations - flags a source whose document has been deleted', async (t) => {
  t.mock.method(documentStore, 'existsMany', async () => new Set(['doc-still-here']));

  const messages = [
    {
      id: 'm1',
      role: 'assistant',
      sources: [
        { sourceNumber: 1, documentId: 'doc-still-here', filename: 'a.pdf' },
        { sourceNumber: 2, documentId: 'doc-deleted', filename: 'b.pdf' },
      ],
    },
  ];

  const result = await annotateStaleCitations(messages);
  assert.strictEqual(result[0].sources[0].documentDeleted, undefined, 'FAIL: a source whose document still exists must not be flagged');
  assert.strictEqual(result[0].sources[1].documentDeleted, true, 'FAIL: a source whose document was deleted must be flagged');
  // Original excerpt/filename content must be preserved untouched.
  assert.strictEqual(result[0].sources[1].filename, 'b.pdf');
});

test('annotateStaleCitations - a message with no sources (a user message) passes through untouched', async (t) => {
  t.mock.method(documentStore, 'existsMany', async () => new Set());
  const messages = [{ id: 'm1', role: 'user', sources: null }];
  const result = await annotateStaleCitations(messages);
  assert.deepStrictEqual(result, messages);
});

test('annotateStaleCitations - no messages reference any document -> skips the existence check entirely', async (t) => {
  let called = false;
  t.mock.method(documentStore, 'existsMany', async () => {
    called = true;
    return new Set();
  });
  const messages = [{ id: 'm1', role: 'user', sources: null }, { id: 'm2', role: 'assistant', sources: [] }];
  await annotateStaleCitations(messages);
  assert.strictEqual(called, false, 'FAIL: should not query document existence when nothing references a document');
});

test('annotateStaleCitations - fails soft: an existence-check error still returns the messages, unannotated', async (t) => {
  t.mock.method(documentStore, 'existsMany', async () => {
    throw new Error('simulated transient DB error');
  });
  const messages = [{ id: 'm1', role: 'assistant', sources: [{ sourceNumber: 1, documentId: 'doc-x', filename: 'a.pdf' }] }];
  const result = await annotateStaleCitations(messages);
  assert.strictEqual(result[0].sources[0].documentDeleted, undefined, 'FAIL: should not throw or crash - just skip the annotation for this request');
  assert.strictEqual(result[0].sources[0].filename, 'a.pdf', 'FAIL: the original message content must still be returned intact');
});
