const { verifyToken } = require('../services/authTokens');
const userStore = require('../db/userStore');

const COOKIE_NAME = 'session';

/**
 * Attaches `req.user` (either `{ id, email }` or `null`) to every request -
 * this is deliberately NOT a gate. A missing/invalid/expired session simply
 * means "this is a guest request," same as it would have been before user
 * accounts existed - it never blocks or 401s on its own. Routes decide
 * what "guest" means for them (usually: scoped to the shared user_id IS
 * NULL pool - see documentStore.js/conversationStore.js), the same way
 * they always have.
 *
 * Reads the session token from an `Authorization: Bearer <token>` header
 * FIRST, falling back to the `session` cookie only if that header is
 * absent. The header is the one that actually matters for this app's
 * typical deployment shape (frontend and backend on separate domains -
 * e.g. Vercel + Render, see the README's Deployment section): a cookie set
 * by the backend there is a third-party cookie from the browser's point of
 * view, and SameSite=Lax (the cookie's own safe default - see
 * setSessionCookie in routes/auth.js) blocks it from ever being sent back
 * on a cross-site fetch/XHR request at all, silently leaving every
 * request looking like a guest even immediately after a successful sign-in.
 * This is exactly the same failure mode middleware/guestQueryLimit.js hit
 * with its own cookie, fixed there the same way: a header the client sends
 * explicitly (see lib/api.ts's getSessionToken/authHeaders), persisted in
 * localStorage, which has none of a cookie's cross-site restrictions.
 * The cookie is still set and still checked as a fallback because it costs
 * nothing to keep and continues to work fine for a same-origin deployment
 * (frontend and backend on the same domain) without needing this header at
 * all.
 */
async function attachUser(req, res, next) {
  const authHeader = req.headers.authorization;
  const headerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const token = headerToken || req.cookies?.[COOKIE_NAME];
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
