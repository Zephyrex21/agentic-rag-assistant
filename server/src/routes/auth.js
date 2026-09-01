const express = require('express');
const userStore = require('../db/userStore');
const otpStore = require('../db/otpStore');
const otp = require('../services/otp');
const emailService = require('../services/emailService');
const { signToken, TOKEN_TTL } = require('../services/authTokens');
const { COOKIE_NAME } = require('../middleware/userAuth');
const { getGuestQueriesRemaining, GUEST_QUERY_LIMIT } = require('../middleware/guestQueryLimit');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // matches authTokens.js's TOKEN_TTL (30d)

// How long a requested code stays valid, and how many wrong guesses are
// allowed against it before it's invalidated outright (forcing a fresh
// request rather than letting someone sit and brute-force a 6-digit space
// against one open attempt window). 10 minutes / 5 attempts are standard,
// unremarkable values for an OTP flow like this - long enough that a
// slightly slow email provider doesn't strand a real user, short/tight
// enough that a guessed code is a near-zero-probability event
// (1,000,000 possibilities, 5 guesses).
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Minimum time between two /otp/request calls for the SAME email - not a
// substitute for the IP-based expensiveLimiter this whole router already
// sits behind (see app.js), but that one can't stop someone hammering a
// SPECIFIC inbox with codes (a different concern: cost/spam to that one
// address, not overall request volume) from behind many different IPs.
const RESEND_COOLDOWN_MS = 45 * 1000;

function errorResponse(res, status, code, message, extra) {
  return res.status(status).json({ error: { code, message, ...extra } });
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

// POST /api/auth/otp/request - starts (or restarts) a sign-in: generates a
// fresh 6-digit code, emails it, and upserts it as the one live code for
// this address (see otpStore.upsert - any previous still-pending code for
// the same email is replaced, not left valid alongside the new one).
// Deliberately the SAME endpoint whether this is someone's first time
// (no user row yet) or their hundredth - account creation only actually
// happens on a successful /otp/verify below, so there's nothing
// email-enumerable here: this responds identically either way.
router.post('/otp/request', async (req, res) => {
  const { email } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return errorResponse(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
  }
  const normalizedEmail = email.trim().toLowerCase();

  // Split into two separately-caught steps (store, then send) rather than
  // one try/catch around both - a single generic "something went wrong"
  // for either failure is genuinely hard to debug from outside (no direct
  // log access), so which STAGE failed is worth surfacing distinctly:
  // OTP_STORE_FAILED almost always means migration_008_email_otp_auth.sql
  // hasn't been run against this Supabase project yet (the otp_codes table
  // doesn't exist), while OTP_EMAIL_FAILED points at the SMTP_* env vars
  // instead. Same two failure modes either way, but conflating them into
  // one message means guessing which one to even go fix first.
  let code;
  try {
    const existing = await otpStore.findByEmail(normalizedEmail);
    if (existing) {
      const elapsedMs = Date.now() - new Date(existing.createdAt).getTime();
      if (elapsedMs < RESEND_COOLDOWN_MS) {
        const secondsRemaining = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
        return errorResponse(
          res,
          429,
          'OTP_RESEND_TOO_SOON',
          `Please wait ${secondsRemaining}s before requesting another code.`,
          { secondsRemaining }
        );
      }
    }

    code = otp.generateCode();
    await otpStore.upsert({
      email: normalizedEmail,
      codeHash: otp.hashCode(code),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MS).toISOString(),
    });
  } catch (err) {
    console.error('[auth] otp/request - storing the code failed:', err.message);
    // Postgres error 42P01 ("undefined_table") / a message mentioning a
    // missing relation is exactly what a not-yet-run migration looks like.
    const looksLikeMissingTable = /relation .* does not exist|42P01/i.test(err.message || '');
    return errorResponse(
      res,
      500,
      'OTP_STORE_FAILED',
      looksLikeMissingTable
        ? "The server's database isn't fully set up yet (the otp_codes table is missing). If you're the site owner: run migration_008_email_otp_auth.sql against your Supabase project, then try again."
        : 'Something went wrong saving your code. Please try again shortly.'
    );
  }

  try {
    await emailService.sendOtpEmail(normalizedEmail, code);
  } catch (err) {
    console.error('[auth] otp/request - sending the email failed:', err.message);
    return errorResponse(
      res,
      500,
      'OTP_EMAIL_FAILED',
      "Your code was generated but the email failed to send. If you're the site owner: double-check SMTP_HOST/SMTP_USER/SMTP_PASS (and that 2-Step Verification + the App Password are still active) in your server's env vars."
    );
  }

  res.json({ sent: true, expiresInSeconds: OTP_EXPIRY_MS / 1000 });
});

// POST /api/auth/otp/verify - the only place an account actually gets
// created (see userStore.findOrCreateByEmail) - a verified email IS the
// account, there's no separate password to set.
router.post('/otp/verify', async (req, res) => {
  const { email, code } = req.body || {};
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return errorResponse(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
  }
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    return errorResponse(res, 400, 'INVALID_CODE', 'Enter the 6-digit code from your email.');
  }
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const record = await otpStore.findByEmail(normalizedEmail);
    if (!record) {
      return errorResponse(res, 400, 'OTP_NOT_FOUND', 'That code has expired or was never requested. Request a new one.');
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      await otpStore.deleteByEmail(normalizedEmail);
      return errorResponse(res, 400, 'OTP_EXPIRED', 'That code has expired. Request a new one.');
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await otpStore.deleteByEmail(normalizedEmail);
      return errorResponse(res, 400, 'OTP_TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.');
    }

    const matches = otp.hashesMatch(otp.hashCode(code.trim()), record.codeHash);
    if (!matches) {
      const attemptsNow = await otpStore.incrementAttempts(normalizedEmail);
      if (attemptsNow >= MAX_ATTEMPTS) {
        await otpStore.deleteByEmail(normalizedEmail);
        return errorResponse(res, 400, 'OTP_TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.');
      }
      return errorResponse(res, 400, 'OTP_INCORRECT', 'That code is incorrect.', {
        attemptsRemaining: MAX_ATTEMPTS - attemptsNow,
      });
    }

    // Correct code - it's now spent, so it can never be replayed even
    // within its expiry window.
    await otpStore.deleteByEmail(normalizedEmail);
    const user = await userStore.findOrCreateByEmail(normalizedEmail);
    setSessionCookie(res, user.id);
    res.json({ user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('[auth] otp/verify failed:', err.message);
    errorResponse(res, 500, 'OTP_VERIFY_FAILED', 'Something went wrong verifying your code. Please try again.');
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
