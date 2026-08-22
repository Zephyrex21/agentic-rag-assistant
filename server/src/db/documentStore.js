const { getSupabase } = require('./supabaseClient');

const TABLE = 'documents';

function toDb(doc) {
  return {
    id: doc.id,
    filename: doc.filename,
    status: doc.status,
    chunk_count: doc.chunkCount,
    uploaded_at: doc.uploadedAt,
    processed_at: doc.processedAt || null,
    error: doc.error || null,
    folder_id: doc.folderId || null,
    content_hash: doc.contentHash || null,
  };
}

function fromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    chunkCount: row.chunk_count,
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    error: row.error,
    // undefined (not null) when the migration hasn't been run yet, so
    // callers/frontend can tell "no folder" apart from "folders aren't
    // supported by this database yet" if that ever matters.
    folderId: 'folder_id' in row ? row.folder_id : undefined,
    contentHash: 'content_hash' in row ? row.content_hash : undefined,
  };
}

async function create(doc) {
  const supabase = getSupabase();
  const payload = toDb(doc);
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
  if (error) {
    // content_hash is the newest column (migration_006) - if it doesn't
    // exist yet on someone's Supabase project, retry once without it
    // rather than failing the upload outright. Duplicate detection is an
    // optional enhancement; uploads working at all is not something it
    // should ever be able to break for someone who hasn't run the latest
    // migration yet.
    if (/content_hash/i.test(error.message) && 'content_hash' in payload) {
      console.warn(
        `[documentStore] insert failed on content_hash (${error.message}) - has migration_006_document_content_hash.sql been run? Retrying without it.`
      );
      const { content_hash, ...withoutHash } = payload;
      const retry = await supabase.from(TABLE).insert(withoutHash).select().single();
      if (retry.error) throw new Error(`documentStore.create failed: ${retry.error.message}`);
      return fromDb(retry.data);
    }
    throw new Error(`documentStore.create failed: ${error.message}`);
  }
  return fromDb(data);
}

async function get(documentId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', documentId).maybeSingle();
  if (error) throw new Error(`documentStore.get failed: ${error.message}`);
  return fromDb(data);
}

/**
 * @param {{ folderId?: string | null, limit?: number, offset?: number }} [options]
 *   - folderId: filter by folder. Pass folderId: null explicitly to list
 *     only uncategorized documents; omit it entirely to list everything
 *     regardless of folder.
 *   - limit/offset: OPT-IN pagination - omitted entirely (the default)
 *     returns every matching row, exactly as before this existed, so every
 *     existing caller (agentTools.listReadyDocuments, the /api/documents
 *     route with no query params, etc.) is completely unaffected. Pass
 *     both to page through a large document set instead of loading it all
 *     at once.
 */
async function list(options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select('*').order('uploaded_at', { ascending: false });
  if ('folderId' in options) {
    query = options.folderId === null ? query.is('folder_id', null) : query.eq('folder_id', options.folderId);
  }
  if (typeof options.limit === 'number') {
    const offset = typeof options.offset === 'number' ? options.offset : 0;
    query = query.range(offset, offset + options.limit - 1);
  }
  const { data, error } = await query;
  if (error) throw new Error(`documentStore.list failed: ${error.message}`);
  return (data || []).map(fromDb);
}

async function updateStatus(documentId, updates) {
  const supabase = getSupabase();
  const dbUpdates = {};
  if ('status' in updates) dbUpdates.status = updates.status;
  if ('chunkCount' in updates) dbUpdates.chunk_count = updates.chunkCount;
  if ('processedAt' in updates) dbUpdates.processed_at = updates.processedAt;
  if ('error' in updates) dbUpdates.error = updates.error;

  const { data, error } = await supabase.from(TABLE).update(dbUpdates).eq('id', documentId).select().maybeSingle();
  if (error) throw new Error(`documentStore.updateStatus failed: ${error.message}`);
  return fromDb(data);
}

/** Assigns (or clears, with folderId: null) a document's folder. Separate
 * from updateStatus since this is a distinct user action (organizing),
 * not a pipeline state transition. */
async function moveToFolder(documentId, folderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ folder_id: folderId })
    .eq('id', documentId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`documentStore.moveToFolder failed: ${error.message}`);
  return fromDb(data);
}

async function remove(documentId) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', documentId);
  if (error) throw new Error(`documentStore.remove failed: ${error.message}`);
  return true;
}

/**
 * Returns a Set of the ids from `documentIds` that still exist - used by
 * conversationStore.getConversation to detect stale citations (a message
 * citing a document that's since been deleted). A single indexed `IN`
 * query rather than a full list() so this scales with the number of
 * documents actually referenced in a conversation, not the total document
 * count.
 */
async function existsMany(documentIds) {
  if (!documentIds || documentIds.length === 0) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('id').in('id', documentIds);
  if (error) throw new Error(`documentStore.existsMany failed: ${error.message}`);
  return new Set((data || []).map((row) => row.id));
}

/**
 * Looks up an existing, non-failed document with the same content hash -
 * used by the upload route to detect a re-upload of the exact same file
 * before spending an ingestion pass (extraction + embedding + Pinecone
 * upsert) on it again. Failed documents are deliberately excluded: if the
 * first attempt never actually made it into the retrieval pool, re-upload
 * isn't a "duplicate" in any sense that matters, it's just a retry.
 */
async function findByContentHash(contentHash) {
  if (!contentHash) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('content_hash', contentHash)
    .neq('status', 'failed')
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`documentStore.findByContentHash failed: ${error.message}`);
  return fromDb(data);
}

module.exports = { create, get, list, updateStatus, moveToFolder, remove, existsMany, findByContentHash };
