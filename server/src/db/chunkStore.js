const { getSupabase } = require('./supabaseClient');

const TABLE = 'chunks';

/**
 * Bulk-inserts chunk rows for a document. Uses the SAME id format as the
 * Pinecone vectors (`${documentId}_chunk_${chunkIndex}`) so RRF fusion in
 * rag.js can match a chunk across both retrieval methods trivially.
 */
async function insertChunks(chunks) {
  if (chunks.length === 0) return;
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).insert(
    chunks.map((c) => ({
      id: c.id,
      document_id: c.documentId,
      filename: c.filename,
      chunk_index: c.chunkIndex,
      section: c.section,
      text: c.text,
    }))
  );
  if (error) throw new Error(`chunkStore.insertChunks failed: ${error.message}`);
}

async function deleteByDocumentId(documentId) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('document_id', documentId);
  if (error) throw new Error(`chunkStore.deleteByDocumentId failed: ${error.message}`);
}

module.exports = { insertChunks, deleteByDocumentId };
