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
    user_id: doc.userId || null,
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
    userId: 'user_id' in row ? row.user_id : undefined,
  };
}

async function create(doc) {
  const supabase = getSupabase();
  const payload = toDb(doc);
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
  if (error) {
    // content_hash/user_id are the newest columns (migrations 006/007) -
    // if either doesn't exist yet on someone's Supabase project, retry
    // once without whichever one the error names, rather than failing the
    // upload outright. Duplicate detection and account ownership are both
    // optional enhancements; uploads working at all is not something
    // either should ever be able to break for someone who hasn't run the
    // latest migration yet.
    const missingColumn = /content_hash/i.test(error.message)
      ? 'content_hash'
      : /user_id/i.test(error.message)
        ? 'user_id'
        : null;
    if (missingColumn && missingColumn in payload) {
      console.warn(
        `[documentStore] insert failed on ${missingColumn} (${error.message}) - has the relevant migration been run? Retrying without it.`
      );
      const withoutColumn = { ...payload };
      delete withoutColumn[missingColumn];
      const retry = await supabase.from(TABLE).insert(withoutColumn).select().single();
      if (retry.error) throw new Error(`documentStore.create failed: ${retry.error.message}`);
      return fromDb(retry.data);
    }
    throw new Error(`documentStore.create failed: ${error.message}`);
  }
  return fromDb(data);
}

/**
 * @param {string} documentId
 * @param {{ userId?: string | null }} [options] - when userId is passed
 *   (including explicitly null for a guest), the lookup is scoped to that
 *   owner - a document belonging to someone else (or to a logged-in
 *   user's account, when looking up as a guest) resolves as not-found
 *   rather than leaking its existence. Omit entirely for the rare
 *   internal case that genuinely needs an unscoped lookup (there isn't
 *   one in this codebase today - every route-facing call should pass it).
 */
async function get(documentId, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select('*').eq('id', documentId);
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`documentStore.get failed: ${error.message}`);
  return fromDb(data);
}

/**
 * @param {{ folderId?: string | null, limit?: number, offset?: number, userId?: string | null }} [options]
 *   - folderId: filter by folder. Pass folderId: null explicitly to list
 *     only uncategorized documents; omit it entirely to list everything
 *     regardless of folder.
 *   - userId: scope to one owner. Pass null explicitly for the guest pool
 *     (user_id IS NULL); omit entirely for the rare unscoped case (see
 *     get()'s doc comment - route-facing calls should always pass this).
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
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
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
 * not a pipeline state transition.
 * @param {{ userId?: string | null }} [options] - see get()'s doc comment. */
async function moveToFolder(documentId, folderId, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).update({ folder_id: folderId }).eq('id', documentId);
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { data, error } = await query.select().maybeSingle();
  if (error) throw new Error(`documentStore.moveToFolder failed: ${error.message}`);
  return fromDb(data);
}

/** @param {{ userId?: string | null }} [options] - see get()'s doc comment. */
async function remove(documentId, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).delete().eq('id', documentId);
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { error } = await query;
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
 * Looks up an existing, non-failed document with the same content hash,
 * scoped to the same owner - used by the upload route to detect a
 * re-upload of the exact same file before spending an ingestion pass
 * (extraction + embedding + Pinecone upsert) on it again. Failed documents
 * are deliberately excluded: if the first attempt never actually made it
 * into the retrieval pool, re-upload isn't a "duplicate" in any sense that
 * matters, it's just a retry. Scoped to `userId` (null for guest) so two
 * different accounts uploading the same public PDF don't collide with
 * each other - duplicate detection is a per-owner concern, not global.
 */
async function findByContentHash(contentHash, options = {}) {
  if (!contentHash) return null;
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select('*').eq('content_hash', contentHash).neq('status', 'failed');
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { data, error } = await query.order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`documentStore.findByContentHash failed: ${error.message}`);
  return fromDb(data);
}

module.exports = { create, get, list, updateStatus, moveToFolder, remove, existsMany, findByContentHash };
