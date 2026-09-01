const { getSupabase } = require('./supabaseClient');

const TABLE = 'users';

function fromDb(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, createdAt: row.created_at };
}

async function findByEmail(email) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw new Error(`userStore.findByEmail failed: ${error.message}`);
  return fromDb(data);
}

async function findById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`userStore.findById failed: ${error.message}`);
  return fromDb(data);
}

/**
 * The only way an account gets created now (see routes/auth.js's OTP
 * verify endpoint) - there's no separate "sign up" step distinct from
 * "log in" anymore. A first-time verified email silently becomes an
 * account; a returning one just logs in. No password_hash is ever set
 * (see migration_008 - the column is nullable now) since there is no
 * password in this flow at all.
 *
 * Race-safe the same way userStore.create used to be for passwords: relies
 * on the DB's unique constraint on `email`, not a check-then-insert, so two
 * concurrent first-time verifications for the same address can't create
 * two rows. If the insert loses that race, this falls back to reading the
 * row the other request just created rather than surfacing an error - from
 * the caller's point of view (routes/auth.js, which already has a
 * just-verified OTP in hand) this must always succeed with SOME user row
 * for this email, never a 409.
 */
async function findOrCreateByEmail(email) {
  const normalized = email.toLowerCase().trim();
  const existing = await findByEmail(normalized);
  if (existing) return existing;

  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).insert({ email: normalized }).select().single();
  if (error) {
    if (error.code === '23505') {
      // Lost a create race against a concurrent verification for the same
      // email - the row now exists, just not from this call.
      const row = await findByEmail(normalized);
      if (row) return row;
    }
    throw new Error(`userStore.findOrCreateByEmail failed: ${error.message}`);
  }
  return fromDb(data);
}

module.exports = { findByEmail, findById, findOrCreateByEmail };
