const { getSupabase } = require('./supabaseClient');

const TABLE = 'otp_codes';

function fromDb(row) {
  if (!row) return null;
  return {
    email: row.email,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}

/**
 * Replaces any existing pending code for this email with a new one
 * (upsert on the `email` primary key - see migration_008) and resets
 * `attempts` back to 0. There's never a reason to keep an old code alive
 * once a new one has been requested/sent - the old one would just be a
 * second valid code sitting around, extending the window past what
 * OTP_EXPIRY_MS actually promises.
 */
async function upsert({ email, codeHash, expiresAt }) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).upsert(
    {
      email: email.toLowerCase().trim(),
      code_hash: codeHash,
      expires_at: expiresAt,
      attempts: 0,
    },
    { onConflict: 'email' }
  );
  if (error) throw new Error(`otpStore.upsert failed: ${error.message}`);
}

async function findByEmail(email) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw new Error(`otpStore.findByEmail failed: ${error.message}`);
  return fromDb(data);
}

/** Bumps the attempt counter after a wrong code - returns the NEW count, so
 * the caller can compare it against the max in one round trip instead of a
 * separate read-after-write. */
async function incrementAttempts(email) {
  const supabase = getSupabase();
  const current = await findByEmail(email);
  const nextAttempts = (current?.attempts || 0) + 1;
  const { error } = await supabase
    .from(TABLE)
    .update({ attempts: nextAttempts })
    .eq('email', email.toLowerCase().trim());
  if (error) throw new Error(`otpStore.incrementAttempts failed: ${error.message}`);
  return nextAttempts;
}

/** Called after a successful verify (the code is now spent - a second
 * verify with the same code must fail) and also used to explicitly
 * invalidate a code (e.g. once the attempt limit is hit). */
async function deleteByEmail(email) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('email', email.toLowerCase().trim());
  if (error) throw new Error(`otpStore.deleteByEmail failed: ${error.message}`);
}

module.exports = { upsert, findByEmail, incrementAttempts, deleteByEmail };
