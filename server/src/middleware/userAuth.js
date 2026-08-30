const { verifyToken } = require('../services/authTokens');
const userStore = require('../db/userStore');

const COOKIE_NAME = 'session';

/**
 * Attaches `req.user` (either `{ id, email }` or `null`) to every request -
 * this is deliberately NOT a gate. A missing/invalid/expired cookie simply
 * means "this is a guest request," same as it would have been before user
 * accounts existed - it never blocks or 401s on its own. Routes decide
 * what "guest" means for them (usually: scoped to the shared user_id IS
 * NULL pool - see documentStore.js/conversationStore.js), the same way
 * they always have.
 *
 * A DB lookup per request (to get the current email, and to confirm the
 * user in the token still exists) is a deliberate choice over trusting the
 * token's payload alone - a deleted account's old, still-unexpired cookie
 * should stop working immediately, not linger for up to 30 days.
 */
async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const userId = verifyToken(token);
  if (!userId) {
    req.user = null;
    return next();
  }
  try {
    const user = await userStore.findById(userId);
    req.user = user ? { id: user.id, email: user.email } : null;
  } catch (err) {
    // A DB hiccup here should degrade to "treat as guest," not break every
    // single request on the site - same fail-soft principle as everywhere
    // else auth-adjacent in this codebase.
    console.warn(`[userAuth] could not resolve session user (${err.message}) - treating request as guest.`);
    req.user = null;
  }
  next();
}

module.exports = { attachUser, COOKIE_NAME };
