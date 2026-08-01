const { getSupabase } = require('./supabaseClient');

const TABLE = 'folders';

function fromDb(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

async function create(name) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).insert({ name }).select().single();
  if (error) throw new Error(`folderStore.create failed: ${error.message}`);
  return fromDb(data);
}

async function list() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: true });
  if (error) throw new Error(`folderStore.list failed: ${error.message}`);
  return (data || []).map(fromDb);
}

/**
 * Deleting a folder does NOT delete its documents - the migration's
 * `on delete set null` foreign key handles uncategorizing them
 * automatically at the database level, so this is just a plain delete.
 */
async function remove(folderId) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', folderId);
  if (error) throw new Error(`folderStore.remove failed: ${error.message}`);
  return true;
}

module.exports = { create, list, remove };
