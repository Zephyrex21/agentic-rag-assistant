const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const MODEL = process.env.EMBEDDING_MODEL || 'jina-embeddings-v3';
const DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10);

/**
 * 768 is one of jina-embeddings-v3's officially supported Matryoshka
 * checkpoint sizes (32/64/128/256/512/768/1024), chosen deliberately to
 * match the existing Pinecone index dimensionality - no index recreation
 * needed when migrating from Gemini's embeddings. (Vectors from a
 * different model are never comparable to old ones regardless of
 * dimension though - re-ingest your documents after switching providers.)
 *
 * Defensive re-normalization even though we request `normalized: true` -
 * cheap insurance in case a response isn't perfectly unit-length, and
 * cosine similarity in Pinecone depends on it.
 */
function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

function getApiKey() {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No API key available for Jina embeddings. Set JINA_API_KEY in server/.env. ' +
        'Get a free key (no credit card required) at https://jina.ai/embeddings/'
    );
  }
  return apiKey;
}

function extractJinaErrorMessage(status, rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    const msg = parsed?.detail || parsed?.error?.message || parsed?.message;
    if (msg) return `Jina embeddings API error (${status}): ${msg}`;
  } catch {
    // raw body wasn't JSON, fall through
  }
  return `Jina embeddings API error (${status}): ${rawBody.slice(0, 300)}`;
}

/**
 * Embeds a batch of texts.
 * @param {string[]} texts
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType - RETRIEVAL_DOCUMENT for
 *   chunks being stored, RETRIEVAL_QUERY for a user's question at query time.
 *   Kept as the same enum-style values the rest of the codebase already
 *   uses (from the Gemini version) so ingestionWorker.js and rag.js don't
 *   need to change - translated internally to Jina's retrieval.passage /
 *   retrieval.query task adapters, which serve the same purpose.
 */
async function embedBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!texts.length) return [];
  const task = taskType === 'RETRIEVAL_QUERY' ? 'retrieval.query' : 'retrieval.passage';

  let response;
  try {
    response = await fetch(JINA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: texts,
        task,
        dimensions: DIMENSIONS,
        normalized: true,
      }),
    });
  } catch (err) {
    // Deliberately NO automatic fallback here, unlike generation/utility -
    // a different embedding model/dimension could silently corrupt (or
    // hard-fail) your Pinecone index. A clear, diagnosable error is safer
    // than a fallback that might succeed but poison your vector store.
    throw new Error(`Jina embeddings request failed: ${err.message}`);
  }

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(extractJinaErrorMessage(response.status, raw));
  }

  const data = await response.json();
  // Response is OpenAI-embeddings-shaped: { data: [{ embedding, index }, ...] }.
  // Items should already be input-order, but sort by `index` defensively.
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => l2Normalize(item.embedding));
}

async function embedOne(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const [vector] = await embedBatch([text], taskType);
  return vector;
}

module.exports = { embedBatch, embedOne, MODEL, DIMENSIONS };
