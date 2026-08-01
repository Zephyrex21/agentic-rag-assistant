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
  };
}

async function create(doc) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).insert(toDb(doc)).select().single();
  if (error) throw new Error(`documentStore.create failed: ${error.message}`);
  return fromDb(data);
}

async function get(documentId) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', documentId).maybeSingle();
  if (error) throw new Error(`documentStore.get failed: ${error.message}`);
  return fromDb(data);
}

/**
 * @param {{ folderId?: string | null }} [options] - filter by folder.
 *   Pass folderId: null explicitly to list only uncategorized documents;
 *   omit it entirely to list everything regardless of folder.
 */
async function list(options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select('*').order('uploaded_at', { ascending: false });
  if ('folderId' in options) {
    query = options.folderId === null ? query.is('folder_id', null) : query.eq('folder_id', options.folderId);
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

module.exports = { create, get, list, updateStatus, moveToFolder, remove };
