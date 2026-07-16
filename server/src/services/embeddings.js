const { getClient } = require('./geminiClient');
const { parseGeminiError } = require('./modelFallback');

const MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
const DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10);

/**
 * gemini-embedding-001 does NOT auto-normalize truncated dimensions
 * (unlike the newer gemini-embedding-2). Since we use 768 dims for
 * cheaper Pinecone storage, we normalize manually here so cosine
 * similarity behaves correctly and consistently.
 */
function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/**
 * Embeds a batch of texts.
 * @param {string[]} texts
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType - RETRIEVAL_DOCUMENT for
 *   chunks being stored, RETRIEVAL_QUERY for a user's question at query time.
 *   Gemini optimizes the embedding differently for each.
 */
async function embedBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!texts.length) return [];
  const ai = getClient('embedding');

  try {
    const response = await ai.models.embedContent({
      model: MODEL,
      contents: texts,
      config: {
        taskType,
        outputDimensionality: DIMENSIONS,
      },
    });

    return response.embeddings.map((e) => l2Normalize(e.values));
  } catch (err) {
    // Deliberately NO automatic fallback here, unlike generation/utility -
    // a different embedding model could produce a different vector
    // dimensionality, which would silently corrupt (or hard-fail) your
    // Pinecone index. A clear, diagnosable error is safer than a fallback
    // that might succeed but poison your vector store. If EMBEDDING_MODEL
    // ever gets deprecated, you'll need to update it AND recreate your
    // Pinecone index if the new model's dimensions differ.
    const { message } = parseGeminiError(err);
    throw new Error(message);
  }
}

async function embedOne(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const [vector] = await embedBatch([text], taskType);
  return vector;
}

module.exports = { embedBatch, embedOne, MODEL, DIMENSIONS };
