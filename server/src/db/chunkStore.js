const { getSupabase } = require('./supabaseClient');

const TABLE = 'chunks';

/**
 * Bulk-inserts chunk rows for a document. Uses the SAME id format as the
 * Pinecone vectors (`${documentId}_chunk_${chunkIndex}`) so RRF fusion in
 * rag.js can match a chunk across both retrieval methods trivially.
 * Each chunk's `userId` (null for guest) is denormalized onto the row so
 * keyword search can filter by owner directly, without a join, on every
 * query - the same reasoning this table already applies to filename/section.
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
      user_id: c.userId ?? null,
    }))
  );
  if (error) {
    // user_id is the newest column (migration_007) - retry without it if
    // that migration hasn't been run yet, same fail-open pattern used
    // elsewhere for newly-added columns.
    if (/user_id/i.test(error.message)) {
      console.warn(
        `[chunkStore] insert failed on user_id (${error.message}) - has migration_007_users_and_ownership.sql been run? Retrying without it.`
      );
      const retry = await supabase.from(TABLE).insert(
        chunks.map((c) => ({
          id: c.id,
          document_id: c.documentId,
          filename: c.filename,
          chunk_index: c.chunkIndex,
          section: c.section,
          text: c.text,
        }))
      );
      if (retry.error) throw new Error(`chunkStore.insertChunks failed: ${retry.error.message}`);
      return;
    }
    throw new Error(`chunkStore.insertChunks failed: ${error.message}`);
  }
}

async function deleteByDocumentId(documentId) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('document_id', documentId);
  if (error) throw new Error(`chunkStore.deleteByDocumentId failed: ${error.message}`);
}

module.exports = { insertChunks, deleteByDocumentId };
