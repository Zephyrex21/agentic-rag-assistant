const { parseIntEnv } = require('../utils/envConfig');

const GUEST_ID_HEADER = 'x-guest-id';
const MAX_GUEST_ID_LENGTH = 100;

// How many questions a guest (no account) gets before being required to
// sign in. Overridable via env for local testing (a smaller number is much
// faster to hit than the real default) or if the product ever wants to
// tune this without a code change.
const GUEST_QUERY_LIMIT = parseIntEnv('GUEST_QUERY_LIMIT', 2, { min: 1 });

/**
 * In-memory, like usageTracker.js - resets on every server restart. That's
 * a real, deliberate limitation: this is meant to stop a casual guest from
 * chatting indefinitely without an account, not to be a bulletproof abuse
 * wall. Someone who clears localStorage, opens a private window, or waits
 * for a server restart gets a fresh count - closing that gap fully would
 * mean fingerprinting or IP-based tracking, which brings its own accuracy
 * and privacy trade-offs this project doesn't take on for what's
 * fundamentally a "nudge toward creating an account" feature, not a
 * paywall.
 */
const queryCountsByGuestId = new Map();

/**
 * Reads the guest id off the X-Guest-Id header - NOT a cookie. This app's
 * frontend and backend are commonly deployed on separate domains (e.g. a
 * Vercel frontend + a Render backend - see the README's Deployment
 * section), and a cookie set by the backend in that shape is a
 * third-party cookie from the browser's point of view. That makes a
 * cookie-based approach silently unreliable in exactly the deployment
 * this project documents as its main supported one:
 *   - SameSite=Lax (the safe default for a cookie like this) blocks the
 *     cookie from being sent on cross-site fetch/XHR requests entirely -
 *     only top-level GET navigations get it, which an API call never is.
 *   - SameSite=None would fix that, but Safari's ITP and Chrome's
 *     third-party-cookie phase-out increasingly block/partition
 *     third-party cookies outright regardless of SameSite.
 * A plain custom header sent explicitly by client code (persisted in
 * localStorage - see lib/api.ts's getGuestId) has none of these
 * restrictions, because it was never a cookie to begin with. This is the
 * same reasoning the access-key feature right next to this one already
 * uses (see middleware/auth.js and lib/api.ts's ACCESS_KEY_STORAGE_KEY) -
 * header + localStorage, not a cookie, for anything the client itself
 * needs to keep sending back.
 *
 * A no-op for anyone with a valid session (req.user is already set by
 * attachUser, which must run before this) - logged-in users are never
 * subject to the guest limit at all, so there's nothing to read for them.
 */
function attachGuestId(req, res, next) {
  if (req.user) return next();

  const headerValue = req.headers[GUEST_ID_HEADER];
  const guestId = typeof headerValue === 'string' ? headerValue.trim().slice(0, MAX_GUEST_ID_LENGTH) : '';
  // Empty string (header missing, e.g. a raw API/curl call that isn't this
  // project's own frontend) becomes null rather than "" - keeps the map
  // free of a shared "" bucket that every headerless caller would
  // otherwise collide into and share a count through.
  req.guestId = guestId || null;
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
  // No id at all means the caller isn't this project's own frontend (which
  // always sends one - see attachGuestId above) - nothing to track a count
  // against, so nothing to enforce. This only affects direct API callers
  // bypassing the UI entirely, not real guest usage through the app.
  if (!guestId) return next();

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
  GUEST_ID_HEADER,
  GUEST_QUERY_LIMIT,
  _resetForTests,
};
