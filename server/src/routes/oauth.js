const express = require('express');
const crypto = require('crypto');

const userStore = require('../db/userStore');
const { signToken } = require('../services/authTokens');
const oauthProviders = require('../services/oauthProviders');

const router = express.Router();

const STATE_COOKIE_NAME = 'oauth_state';
const STATE_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // the whole round trip to the provider and back should take seconds, not minutes - 10m is generous, not a real session

// Where this deployment's own backend can be reached at, for building the
// redirect_uri sent to each provider - this MUST byte-for-byte match
// whatever's registered in that provider's OAuth app console (Google Cloud
// Console / GitHub OAuth Apps), or the provider rejects the exchange
// outright. Falls back to constructing it from the request itself in dev
// (works fine behind Vite's proxy / plain localhost), but a real
// deployment should set this explicitly - a request's own Host header
// isn't trustworthy enough to build a security-relevant redirect URI from
// in production (see req.protocol/req.get('host') being spoofable without
// `trust proxy` correctly scoped, which this app does set - see app.js -
// but pinning it via env removes any doubt).
function getBackendUrl(req) {
  return process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
}

// Where to send the browser back to once the whole OAuth round trip is
// done, success or failure - the actual frontend the person started from.
// Unlike getBackendUrl above, there's no safe way to derive this from the
// request (the request at this point is a redirect FROM the provider TO
// our backend - it carries no information about which frontend origin
// initiated the flow), so this one has no same-origin fallback: it's
// required for OAuth to do anything useful in this app's typical
// separate-domain deployment. Defaults to '/' only so a misconfigured
// deployment fails obviously (a broken redirect to the backend's own root)
// rather than throwing.
function getFrontendUrl() {
  return process.env.FRONTEND_URL || '/';
}

function redirectWithError(res, message) {
  const url = new URL(getFrontendUrl(), 'http://placeholder-base-for-relative-urls.invalid');
  url.hash = `oauth_error=${encodeURIComponent(message)}`;
  // The URL constructor needs SOME base to resolve a relative FRONTEND_URL
  // ('/') against - the placeholder above is never actually used as long
  // as getFrontendUrl() returns a real absolute URL (which it always
  // should in any deployment that actually configured OAuth), and the
  // fallback case redirecting to a nonsense host is exactly the "fail
  // obviously" behavior the comment above calls for.
  res.redirect(url.toString().replace('http://placeholder-base-for-relative-urls.invalid', ''));
}

// GET /api/auth/oauth/:provider - starts the flow. A real top-level
// browser navigation (an <a>/window.location.href click, never a fetch()
// call - see AuthModal.tsx), which is exactly why this whole router is
// mounted BEFORE requireAppAccessKey in app.js: a navigation can't attach
// a custom X-App-Access-Key header the way every fetch() call in this app
// otherwise does, so the site-wide access key gate literally cannot be
// satisfied here. The risk this accepts is narrow and was a deliberate
// call, not an oversight - see app.js's own comment at the mount point for
// the full reasoning.
router.get('/:provider', (req, res) => {
  const { provider } = req.params;
  if (!oauthProviders.isValidProvider(provider)) {
    return res.status(404).json({ error: { code: 'UNKNOWN_PROVIDER', message: `Unknown OAuth provider: ${provider}` } });
  }
  if (!oauthProviders.isProviderConfigured(provider)) {
    return redirectWithError(res, `${oauthProviders.getProviderLabel(provider)} sign-in isn't configured on this deployment yet.`);
  }

  const state = crypto.randomBytes(20).toString('hex');
  res.cookie(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // safe here specifically because this cookie only ever needs to survive a same-site round trip through THIS backend's own domain - see the comment in routes/auth.js's setSessionCookie for why that assumption does NOT hold for the actual session cookie
    maxAge: STATE_COOKIE_MAX_AGE_MS,
    path: '/api/auth/oauth',
  });

  const redirectUri = `${getBackendUrl(req)}/api/auth/oauth/${provider}/callback`;
  res.redirect(oauthProviders.buildAuthorizeUrl(provider, state, redirectUri));
});

// GET /api/auth/oauth/:provider/callback - where the provider sends the
// browser back to. Also a top-level navigation, for the same reason as
// above, and also mounted ahead of the access-key gate.
router.get('/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query;

  const cookieState = req.cookies?.[STATE_COOKIE_NAME];
  res.clearCookie(STATE_COOKIE_NAME, { path: '/api/auth/oauth' });

  if (!oauthProviders.isValidProvider(provider)) {
    return res.status(404).json({ error: { code: 'UNKNOWN_PROVIDER', message: `Unknown OAuth provider: ${provider}` } });
  }
  if (providerError) {
    // The person clicked "Cancel"/"Deny" on the provider's own consent
    // screen, or the provider itself rejected the request - either way,
    // not a bug, just an unfinished sign-in.
    return redirectWithError(res, `${oauthProviders.getProviderLabel(provider)} sign-in was cancelled.`);
  }
  if (!code || !state || !cookieState || state !== cookieState) {
    return redirectWithError(res, 'Sign-in link expired or was invalid. Please try again.');
  }

  try {
    const redirectUri = `${getBackendUrl(req)}/api/auth/oauth/${provider}/callback`;
    const email = await oauthProviders.exchangeCodeForEmail(provider, code, redirectUri);
    const user = await userStore.findOrCreateByEmail(email);
    const token = signToken(user.id);

    const url = new URL(getFrontendUrl(), 'http://placeholder-base-for-relative-urls.invalid');
    url.hash = `oauth_token=${token}`;
    res.redirect(url.toString().replace('http://placeholder-base-for-relative-urls.invalid', ''));
  } catch (err) {
    console.error(`[oauth] ${provider} callback failed:`, err.message);
    redirectWithError(res, `Something went wrong signing in with ${oauthProviders.getProviderLabel(provider)}. Please try again.`);
  }
});

module.exports = router;
