const { Pinecone } = require('@pinecone-database/pinecone');

let client = null;
let indexHandle = null;

function getIndex() {
  if (!process.env.PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY is not set. Add it to server/.env before uploading documents.');
  }
  if (!process.env.PINECONE_INDEX_NAME) {
    throw new Error('PINECONE_INDEX_NAME is not set. Add it to server/.env (create the index in the Pinecone console first).');
  }
  if (!client) {
    client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }
  if (!indexHandle) {
    indexHandle = client.index(process.env.PINECONE_INDEX_NAME);
  }
  return indexHandle;
}

/**
 * Upserts chunk vectors for a document.
 * @param {Array<{id: string, values: number[], metadata: object}>} vectors
 */
async function upsertVectors(vectors) {
  const index = getIndex();
  // Pinecone recommends batching upserts in groups of ~100
  const BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await index.upsert(batch);
  }
}

/**
 * Similarity search - returns top-k matches with metadata.
 */
async function queryVectors(vector, topK = 5, filter = undefined) {
  const index = getIndex();
  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
    ...(filter ? { filter } : {}),
  });
  return result.matches || [];
}

/**
 * Deletes all vectors belonging to a document.
 *
 * IMPORTANT: this deletes by an explicit list of vector IDs, NOT by a
 * metadata filter. Two real reasons for that:
 *   1. Delete-by-metadata-filter is a pod-based-index-only Pinecone
 *      feature - it silently doesn't work on serverless indexes, which is
 *      what the free tier (and this project's setup instructions) uses.
 *   2. Even on an index that supports it, the correct filter shape for
 *      deleteMany() doesn't take a `filter:` wrapper the way `update()`
 *      does - passing one produces an "unsupported operator" error.
 *
 * Deleting by ID sidesteps both issues entirely and works on every index
 * type, because we already know the exact IDs deterministically - they're
 * generated as `${documentId}_chunk_${chunkIndex}` during ingestion
 * (see workers/ingestionWorker.js), so we just reconstruct that same list
 * here using the document's known chunk count.
 *
 * @param {string} documentId
 * @param {number} chunkCount - from documentStore, how many chunks this document has
 */
async function deleteByDocumentId(documentId, chunkCount) {
  if (!chunkCount || chunkCount <= 0) return; // nothing was ever indexed - nothing to delete

  const index = getIndex();
  const ids = Array.from({ length: chunkCount }, (_, i) => `${documentId}_chunk_${i}`);

  const BATCH_SIZE = 1000; // Pinecone's ID-based delete supports large batches
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    await index.deleteMany(ids.slice(i, i + BATCH_SIZE));
  }
}

module.exports = { upsertVectors, queryVectors, deleteByDocumentId };
