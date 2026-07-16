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

async function list() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').order('uploaded_at', { ascending: false });
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

async function remove(documentId) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', documentId);
  if (error) throw new Error(`documentStore.remove failed: ${error.message}`);
  return true;
}

module.exports = { create, get, list, updateStatus, remove };
