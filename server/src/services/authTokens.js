const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT_SECRET is optional in the sense that the server still boots without
// it (matching this codebase's "never let a missing optional secret take
// down the whole app" convention - see APP_ACCESS_KEY, GROQ_API_KEY, etc.)
// but a per-boot random fallback means every restart invalidates every
// existing session cookie, which is a real (if low-stakes) inconvenience
// in production. Set JWT_SECRET explicitly for any deployment where
// people should actually stay logged in across restarts.
let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[auth] JWT_SECRET is not set - using a random secret generated for this process only. ' +
      'Every restart will sign users out. Set JWT_SECRET in server/.env before deploying.'
  );
}

const TOKEN_TTL = '30d';

function signToken(userId) {
  return jwt.sign({ sub: userId }, secret, { expiresIn: TOKEN_TTL });
}

/** Returns the userId if the token is valid, otherwise null - never throws,
 * since an expired/tampered/missing token should just mean "treat this
 * request as a guest," not a hard error. */
function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

module.exports = { signToken, verifyToken, TOKEN_TTL };
