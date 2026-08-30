const bcrypt = require('bcryptjs');
const { getSupabase } = require('./supabaseClient');

const TABLE = 'users';
// 10 rounds is bcrypt's own commonly-recommended default for an
// interactive login flow - enough cost to make offline brute-forcing a
// stolen hash meaningfully slow, without making signup/login feel sluggish
// on ordinary hardware (unlike a data-processing job, this runs inline in
// a request a real person is waiting on).
const SALT_ROUNDS = 10;

function fromDb(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at };
}

/**
 * Creates a new user, hashing the password before it ever reaches the
 * database - throws a plain Error with a user-safe message on a duplicate
 * email (checked via Postgres's own unique constraint on `email`, not a
 * separate pre-check, to avoid a check-then-insert race between two
 * concurrent signups for the same address).
 */
async function create({ email, password }) {
  const supabase = getSupabase();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('An account with this email already exists.');
    throw new Error(`userStore.create failed: ${error.message}`);
  }
  return fromDb(data);
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

/** Verifies a plaintext password against a user's stored hash. */
async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

module.exports = { create, findByEmail, findById, verifyPassword };
