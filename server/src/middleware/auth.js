/**
 * Lightweight shared-secret auth for a single-user/portfolio deployment.
 *
 * This is deliberately NOT a full user/session system (no signup, no JWTs,
 * no per-user data isolation) - that would be a much bigger change than
 * this project's single-tenant data model supports today (see README's
 * Known Limitations). What this DOES fix is the critical gap it used to
 * have: with no auth layer at all, anyone who found the deployed URL could
 * upload documents, run queries (burning the free-tier Groq/Jina/Pinecone
 * quota), or delete conversations/documents. A single shared access key
 * closes that off with a proportional amount of complexity for a
 * single-user app.
 *
 * Opt-in via APP_ACCESS_KEY, the same pattern ALLOWED_ORIGIN already uses
 * in app.js: unset (the default) means auth is skipped entirely, so local
 * dev and the existing test suite (which never send an auth header) keep
 * working exactly as before. Set it before any public deployment.
 *
 * The frontend sends the key back as `X-App-Access-Key` on every request
 * once the person enters it once (see client/src/lib/api.ts / AccessGate.tsx) -
 * stored in localStorage, never in a cookie, so there's nothing for CSRF
 * to exploit.
 */
function timingSafeEqual(a, b) {
  // Deliberately constant-time-ish: comparing full length first means a
  // wrong-length guess is rejected the same way a same-length wrong guess
  // is - this is not military-grade constant-time comparison, but it's a
  // meaningful improvement over `===` for a single shared secret, at zero
  // extra dependency cost (no need to pull in node:crypto's timingSafeEqual
  // and deal with Buffer length matching for a value this short-lived).
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Express middleware. Checks the `X-App-Access-Key` header against
 * APP_ACCESS_KEY. If APP_ACCESS_KEY is unset, this is a no-op (auth
 * disabled) - matches every other opt-in toggle in this codebase.
 */
function requireAppAccessKey(req, res, next) {
  const expectedKey = process.env.APP_ACCESS_KEY;
  if (!expectedKey) return next(); // auth disabled - unset is the explicit "don't require this" signal

  const providedKey = req.get('X-App-Access-Key') || '';
  if (timingSafeEqual(providedKey, expectedKey)) return next();

  res.status(401).json({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid access key. Provide it via the X-App-Access-Key header.',
    },
  });
}

module.exports = { requireAppAccessKey, timingSafeEqual };
