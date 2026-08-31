const crypto = require('crypto');
const { parseIntEnv } = require('../utils/envConfig');

const GUEST_COOKIE_NAME = 'guest_id';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30d - matches the session cookie in routes/auth.js

// How many questions a guest (no account) gets before being required to
// sign in. Overridable via env for local testing (a smaller number is much
// faster to hit than the real default) or if the product ever wants to
// tune this without a code change.
const GUEST_QUERY_LIMIT = parseIntEnv('GUEST_QUERY_LIMIT', 2, { min: 1 });

/**
 * In-memory, like usageTracker.js - resets on every server restart. That's
 * a real, deliberate limitation: this is meant to stop a casual guest from
 * chatting indefinitely without an account, not to be a bulletproof abuse
 * wall. Someone who clears cookies, opens a private window, or waits for a
 * server restart gets a fresh count - closing that gap fully would mean
 * fingerprinting or IP-based tracking, which brings its own accuracy and
 * privacy trade-offs this project doesn't take on for what's fundamentally
 * a "nudge toward creating an account" feature, not a paywall.
 */
const queryCountsByGuestId = new Map();

/**
 * Assigns every guest request a stable, httpOnly id cookie - separate from
 * the account session cookie (see routes/auth.js's COOKIE_NAME), since a
 * guest by definition has no session. httpOnly means client-side JS can
 * never read or clear it, so a normal page refresh (or even closing and
 * reopening the tab) keeps the same id and the same count; only actually
 * clearing cookies/site data or switching browser profiles resets it - the
 * same trade-off every cookie-based anonymous-usage tracker makes.
 *
 * A no-op for anyone with a valid session (req.user is already set by
 * attachUser, which must run before this) - logged-in users are never
 * subject to the guest limit at all, so there's nothing to track for them.
 */
function attachGuestId(req, res, next) {
  if (req.user) return next();

  let guestId = req.cookies?.[GUEST_COOKIE_NAME];
  if (!guestId) {
    guestId = crypto.randomUUID();
    res.cookie(GUEST_COOKIE_NAME, guestId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
  req.guestId = guestId;
  next();
}

/**
 * Gate for the two endpoints that actually run the (expensive) RAG
 * pipeline - POST /api/query and POST /api/conversations/:id/messages.
 * Deliberately mounted directly on those routes (not globally) so it never
 * touches document uploads, folder management, or conversation
 * listing/creation - only asking a question counts against the limit.
 *
 * Responds with a plain JSON 403 BEFORE either route commits to an SSE
 * response, matching the existing convention (see query.js/conversations.js's
 * own pre-flight validation) of failing fast with a normal HTTP error
 * rather than an `error` SSE event once streaming has already started.
 */
function enforceGuestQueryLimit(req, res, next) {
  if (req.user) return next(); // signed-in users are never limited

  const guestId = req.guestId;
  const count = queryCountsByGuestId.get(guestId) || 0;

  if (count >= GUEST_QUERY_LIMIT) {
    return res.status(403).json({
      error: {
        code: 'GUEST_LIMIT_REACHED',
        message: `You've used your ${GUEST_QUERY_LIMIT} free questions as a guest. Sign in (it's free) to keep the conversation going.`,
        guestQueryLimit: GUEST_QUERY_LIMIT,
      },
    });
  }

  queryCountsByGuestId.set(guestId, count + 1);
  // Exposed so the route handler can pass it down to the client (e.g. in
  // the `done` SSE event), letting the UI show "1 free question left"
  // instead of the limit only ever appearing as a sudden hard stop.
  req.guestQueriesRemaining = GUEST_QUERY_LIMIT - (count + 1);
  next();
}

/** Read-only lookup for routes that want to report remaining count without
 * consuming one (e.g. GET /api/auth/me) - never increments. */
function getGuestQueriesRemaining(guestId) {
  if (!guestId) return GUEST_QUERY_LIMIT;
  const count = queryCountsByGuestId.get(guestId) || 0;
  return Math.max(0, GUEST_QUERY_LIMIT - count);
}

// Exposed purely for tests - see usageTracker.js's _resetForTests for the
// same pattern/rationale (module-level state otherwise leaks across test
// files sharing node's module cache).
function _resetForTests() {
  queryCountsByGuestId.clear();
}

module.exports = {
  attachGuestId,
  enforceGuestQueryLimit,
  getGuestQueriesRemaining,
  GUEST_COOKIE_NAME,
  GUEST_QUERY_LIMIT,
  _resetForTests,
};
