const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// node --test runs each file in its own process, so seeding require.cache
// here (before rag.js is loaded and destructures its imports) is isolated
// from every other test file.
const SRC = path.join(__dirname, '..', 'src');
function inject(rel, exports) {
  const file = require.resolve(path.join(SRC, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
}

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';

const CHUNK = { id: 'c1', metadata: { documentId: 'doc-1', filename: 'a.pdf', chunkIndex: 0, section: null, text: 'Some passage about networks.' } };
inject('services/embeddings.js', { embedOne: async () => [0.1, 0.2], embedBatch: async () => [[0.1, 0.2]] });
inject('services/pinecone.js', { queryVectors: async () => [{ ...CHUNK, score: 0.9 }], upsertVectors: async () => {} });
inject('services/keywordSearch.js', { keywordSearch: async () => [] });
inject('services/queryExpansion.js', { expandQuery: async () => ['variant one', 'variant two'] });
inject('services/reranker.js', { rerank: async (_q, candidates, topK) => candidates.slice(0, topK) });

const { runRetrieval } = require('../src/services/rag');
const { buildTrace } = require('../src/services/traceBuilder');

test('runRetrieval - records expansionEnabled so the trace never says "Disabled" while variants were actually searched', async () => {
  const { traceRaw } = await runRetrieval('tell me about this document', ['doc-1'], 'tell me about this document', null);

  assert.strictEqual(traceRaw.expansionEnabled, true);
  assert.deepStrictEqual(traceRaw.expandedQueries, ['variant one', 'variant two']);
  assert.strictEqual(traceRaw.queryVariantCount, 3);

  // And end to end: the stage the inspector renders must carry enabled=true.
  const trace = buildTrace({ mode: 'fixed', originalQuestion: 'q', rewriteEnabled: true, searchQuery: 'q', ...traceRaw });
  const expansionStage = trace.stages.find((s) => s.key === 'expansion');
  assert.strictEqual(expansionStage.data.enabled, true);
  assert.deepStrictEqual(expansionStage.data.variants, ['variant one', 'variant two']);
});
