const express = require('express');
const userStore = require('../db/userStore');
const { signToken, TOKEN_TTL } = require('../services/authTokens');
const { COOKIE_NAME } = require('../middleware/userAuth');
const { getGuestQueriesRemaining, GUEST_QUERY_LIMIT } = require('../middleware/guestQueryLimit');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // matches authTokens.js's TOKEN_TTL (30d)

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function setSessionCookie(res, userId) {
  const token = signToken(userId);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // never readable from JS - the actual XSS-resistance win of a cookie over localStorage
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return errorResponse(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(res, 400, 'INVALID_PASSWORD', `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  try {
    const user = await userStore.create({ email, password });
    setSessionCookie(res, user.id);
    res.status(201).json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    // userStore.create already turns a duplicate-email DB error into this
    // exact user-safe message (see its own comment on why: a unique
    // constraint, not a separate pre-check, avoids a signup race).
    if (err.message.includes('already exists')) {
      return errorResponse(res, 409, 'EMAIL_TAKEN', err.message);
    }
    console.error('[auth] signup failed:', err.message);
    errorResponse(res, 500, 'SIGNUP_FAILED', 'Something went wrong creating your account. Please try again.');
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return errorResponse(res, 400, 'INVALID_CREDENTIALS', 'Email and password are both required.');
  }

  try {
    const user = await userStore.findByEmail(email);
    // Deliberately the same generic message whether the email doesn't
    // exist or the password is wrong - distinguishing the two lets an
    // attacker enumerate which emails have accounts.
    const genericError = () => errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
    if (!user) return genericError();

    const valid = await userStore.verifyPassword(user, password);
    if (!valid) return genericError();

    setSessionCookie(res, user.id);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('[auth] login failed:', err.message);
    errorResponse(res, 500, 'LOGIN_FAILED', 'Something went wrong signing you in. Please try again.');
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ success: true });
});

// GET /api/auth/me - returns the current session's user, or null for a guest.
// Never errors on a missing/invalid session (see attachUser's own
// fail-soft behavior) - this endpoint's whole job is just to report
// whichever of the two attachUser already decided. For a guest, also
// reports how many free questions are left (a read-only lookup - never
// consumes one), so the UI can show this up front on load instead of only
// ever finding out via a sudden 403 on the next message.
router.get('/me', (req, res) => {
  res.json({
    user: req.user,
    guestQueriesRemaining: req.user ? null : getGuestQueriesRemaining(req.guestId),
    guestQueryLimit: req.user ? null : GUEST_QUERY_LIMIT,
  });
});

module.exports = { router, TOKEN_TTL };
