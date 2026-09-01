const crypto = require('crypto');

const CODE_LENGTH = 6;

/**
 * A 6-digit numeric code, zero-padded (so "042917" stays 6 characters, not
 * "42917"). crypto.randomInt (not Math.random) - a login credential, even a
 * short-lived one, shouldn't ride on a non-cryptographic RNG.
 */
function generateCode() {
  const max = 10 ** CODE_LENGTH;
  return crypto.randomInt(0, max).toString().padStart(CODE_LENGTH, '0');
}

/**
 * sha256, not bcrypt - deliberately. bcrypt's whole point is making an
 * OFFLINE brute-force of a stolen hash expensive; that's the right tool
 * for a password, which is high-entropy and reused across logins
 * indefinitely. A 6-digit OTP is the opposite: low entropy by design (only
 * 1,000,000 possibilities) but single-use and short-lived (see
 * OTP_EXPIRY_MS in routes/auth.js), with attempts capped server-side
 * (otpStore.js's MAX_ATTEMPTS) - the real defense is the expiry + attempt
 * limit, not hash cost. A fast hash here just avoids paying bcrypt's
 * per-request cost (meaningful at even modest request volume) for
 * protection an attempt limit already provides.
 */
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Constant-time comparison of two hashes - a plain === here would leak
 * timing information about how many leading bytes matched, letting an
 * attacker who can measure response time narrow down the correct code
 * faster than the attempt limit alone would allow. */
function hashesMatch(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { generateCode, hashCode, hashesMatch };
