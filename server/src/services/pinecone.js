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
 * Deletes all vectors belonging to a document (matched by metadata filter).
 */
async function deleteByDocumentId(documentId) {
  const index = getIndex();
  await index.deleteMany({ filter: { documentId: { $eq: documentId } } });
}

module.exports = { upsertVectors, queryVectors, deleteByDocumentId };
