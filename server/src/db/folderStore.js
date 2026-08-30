const { getSupabase } = require('./supabaseClient');

const TABLE = 'folders';

function fromDb(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, createdAt: row.created_at, userId: 'user_id' in row ? row.user_id : undefined };
}

/** @param {{ userId?: string | null }} [options] - null for a guest folder,
 *  a real id to own it; omitted only for internal/legacy callers. */
async function create(name, options = {}) {
  const supabase = getSupabase();
  const payload = { name };
  if ('userId' in options) payload.user_id = options.userId;
  const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
  if (error) {
    // user_id is the newest column (migration_007) - retry without it if
    // that migration hasn't been run yet, same fail-open pattern used
    // elsewhere for newly-added columns.
    if (/user_id/i.test(error.message) && 'user_id' in payload) {
      console.warn(
        `[folderStore] insert failed on user_id (${error.message}) - has migration_007_users_and_ownership.sql been run? Retrying without it.`
      );
      const { user_id, ...withoutUserId } = payload;
      const retry = await supabase.from(TABLE).insert(withoutUserId).select().single();
      if (retry.error) throw new Error(`folderStore.create failed: ${retry.error.message}`);
      return fromDb(retry.data);
    }
    throw new Error(`folderStore.create failed: ${error.message}`);
  }
  return fromDb(data);
}

/** @param {{ userId?: string | null }} [options] - scopes to one owner
 *  (null = guest pool); omitted only for the rare unscoped/internal case. */
async function list(options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).select('*').order('created_at', { ascending: true });
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { data, error } = await query;
  if (error) throw new Error(`folderStore.list failed: ${error.message}`);
  return (data || []).map(fromDb);
}

/**
 * Deleting a folder does NOT delete its documents - the migration's
 * `on delete set null` foreign key handles uncategorizing them
 * automatically at the database level, so this is just a plain delete.
 * @param {{ userId?: string | null }} [options] - see list()'s doc comment.
 */
async function remove(folderId, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(TABLE).delete().eq('id', folderId);
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { error } = await query;
  if (error) throw new Error(`folderStore.remove failed: ${error.message}`);
  return true;
}

module.exports = { create, list, remove };
