const fs = require('fs');
const { extractText } = require('../services/textExtraction');
const { chunkDocument } = require('../services/chunking');
const { embedBatch } = require('../services/embeddings');
const { upsertVectors } = require('../services/pinecone');
const documentStore = require('../db/documentStore');
const chunkStore = require('../db/chunkStore');

/**
 * Runs the full ingestion pipeline for a single document.
 * Designed to be fired-and-forgotten by the upload route: it updates the
 * document's status in the store as it progresses, so the frontend can
 * poll GET /api/documents/:id/status instead of blocking the upload request.
 */
async function processDocument({ documentId, filePath, filename }) {
  try {
    // 1. Extract raw text
    const rawText = await extractText(filePath);
    if (!rawText || !rawText.trim()) {
      throw new Error('No extractable text found in this file.');
    }

    // 2. Chunk (structure-aware for markdown, word-window otherwise)
    const chunks = chunkDocument(rawText, filename);
    if (chunks.length === 0) {
      throw new Error('Document produced zero chunks after processing.');
    }

    // 3. Embed all chunks (batched)
    const vectors = await embedBatch(chunks.map((c) => c.text));

    // 4. Build Pinecone upsert payload with citation metadata
    const pineconeVectors = chunks.map((chunk, i) => ({
      id: `${documentId}_chunk_${chunk.chunkIndex}`,
      values: vectors[i],
      metadata: {
        documentId,
        filename,
        chunkIndex: chunk.chunkIndex,
        section: chunk.section || 'N/A',
        text: chunk.text, // stored so retrieval doesn't need a second lookup
      },
    }));

    // 5. Push to Pinecone (vector search) and Supabase (keyword search) -
    //    both use the same chunk IDs so hybrid retrieval can fuse them
    await upsertVectors(pineconeVectors);
    await chunkStore.insertChunks(
      chunks.map((chunk) => ({
        id: `${documentId}_chunk_${chunk.chunkIndex}`,
        documentId,
        filename,
        chunkIndex: chunk.chunkIndex,
        section: chunk.section || 'N/A',
        text: chunk.text,
      }))
    );

    // 6. Mark ready
    await documentStore.updateStatus(documentId, {
      status: 'ready',
      chunkCount: chunks.length,
      processedAt: new Date().toISOString(),
    });

    console.log(`[ingestion] ✅ ${filename} (${documentId}) processed — ${chunks.length} chunks`);
  } catch (err) {
    console.error(`[ingestion] ❌ ${filename} (${documentId}) failed:`, err.message);
    await documentStore.updateStatus(documentId, {
      status: 'failed',
      error: err.message,
    });
  } finally {
    // Clean up the temp uploaded file regardless of outcome
    fs.unlink(filePath, () => {});
  }
}

module.exports = { processDocument };
