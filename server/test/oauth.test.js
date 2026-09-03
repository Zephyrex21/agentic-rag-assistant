const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'FRONTEND_URL', 'BACKEND_URL', 'APP_ACCESS_KEY'];
let savedEnv;

test.beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.FRONTEND_URL = 'https://frontend.example.com';
  process.env.BACKEND_URL = 'https://backend.example.com';
  process.env.GOOGLE_CLIENT_ID = 'test-google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function getApp() {
  // app.js reads several of these env vars at require-time indirectly via
  // the modules it wires up, but the OAuth-relevant checks all happen
  // per-request (isProviderConfigured, getFrontendUrl, etc.) - a fresh
  // require per test isn't needed, the existing cached app instance
  // re-reads process.env on every request.
  return require('../src/app');
}

test('GET /api/auth/oauth/unknown-provider - 404s cleanly rather than crashing', async () => {
  const res = await request(getApp()).get('/api/auth/oauth/unknown-provider');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error.code, 'UNKNOWN_PROVIDER');
});

test('GET /api/auth/oauth/github - an unconfigured provider redirects to the frontend with oauth_error, not a crash', async () => {
  // GOOGLE_* is configured in beforeEach, GITHUB_* deliberately is not.
  const res = await request(getApp()).get('/api/auth/oauth/github');
  assert.strictEqual(res.status, 302);
  const location = res.headers.location;
  assert.match(location, /^https:\/\/frontend\.example\.com/);
  assert.match(location, /oauth_error=/);
  assert.match(decodeURIComponent(location), /GitHub sign-in isn't configured/);
});

test('GET /api/auth/oauth/google - a configured provider redirects to Google with a state param, and sets a matching state cookie', async () => {
  const res = await request(getApp()).get('/api/auth/oauth/google');
  assert.strictEqual(res.status, 302);
  const location = new URL(res.headers.location);
  assert.strictEqual(location.hostname, 'accounts.google.com');
  assert.strictEqual(location.searchParams.get('client_id'), 'test-google-id');
  assert.strictEqual(location.searchParams.get('redirect_uri'), 'https://backend.example.com/api/auth/oauth/google/callback');
  const state = location.searchParams.get('state');
  assert.ok(state && state.length > 0);

  const setCookie = res.headers['set-cookie']?.join(';') || '';
  assert.match(setCookie, new RegExp(`oauth_state=${state}`));
  assert.ok(/HttpOnly/i.test(setCookie));
});

// This is the critical regression test: the whole reason oauth.js is
// mounted ahead of requireAppAccessKey in app.js is that a real browser
// navigation (which this route only ever receives) can't attach a custom
// header - if this test ever starts getting a 401, the mount-order fix
// has regressed and OAuth sign-in would be completely broken on any
// deployment that sets APP_ACCESS_KEY.
test('GET /api/auth/oauth/google - works with NO X-App-Access-Key header even when APP_ACCESS_KEY is set', async () => {
  process.env.APP_ACCESS_KEY = 'super-secret-key';
  const res = await request(getApp()).get('/api/auth/oauth/google'); // deliberately no .set('X-App-Access-Key', ...)
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.location, /accounts\.google\.com/);
});

test('GET /api/auth/oauth/google/callback - the provider denying consent redirects with a clear "cancelled" message', async () => {
  const res = await request(getApp()).get('/api/auth/oauth/google/callback?error=access_denied');
  assert.strictEqual(res.status, 302);
  assert.match(decodeURIComponent(res.headers.location), /cancelled/);
});

test('GET /api/auth/oauth/google/callback - a missing or mismatched state is rejected (CSRF protection)', async () => {
  const agent = request.agent(getApp());
  // No prior /oauth/google call in this test, so no state cookie exists at all.
  const res = await agent.get('/api/auth/oauth/google/callback?code=somecode&state=whatever');
  assert.strictEqual(res.status, 302);
  assert.match(decodeURIComponent(res.headers.location), /expired or was invalid/);
});

test('GET /api/auth/oauth/google/callback - a real, matching state succeeds and returns a usable bearer token', async (t) => {
  const oauthProviders = require('../src/services/oauthProviders');
  const userStore = require('../src/db/userStore');
  t.mock.method(oauthProviders, 'exchangeCodeForEmail', async () => 'new-oauth-user@example.com');
  t.mock.method(userStore, 'findOrCreateByEmail', async (email) => ({ id: 'oauth-user-1', email, createdAt: 'now' }));

  const agent = request.agent(getApp());
  const kickoffRes = await agent.get('/api/auth/oauth/google');
  const state = new URL(kickoffRes.headers.location).searchParams.get('state');

  const callbackRes = await agent.get(`/api/auth/oauth/google/callback?code=real-code&state=${state}`);
  assert.strictEqual(callbackRes.status, 302);
  const location = new URL(callbackRes.headers.location);
  assert.strictEqual(location.origin, 'https://frontend.example.com');
  const hashParams = new URLSearchParams(location.hash.slice(1));
  const token = hashParams.get('oauth_token');
  assert.ok(token && token.length > 0);

  // The token must actually work, the same way the OTP flow's does - see
  // accountAuth.test.js's equivalent full-flow test.
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'new-oauth-user@example.com' }));
  const meRes = await request(getApp()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.body.user.email, 'new-oauth-user@example.com');
});

test('GET /api/auth/oauth/google/callback - a provider exchange failure redirects with a clear, provider-attributed error instead of crashing', async (t) => {
  const oauthProviders = require('../src/services/oauthProviders');
  t.mock.method(oauthProviders, 'exchangeCodeForEmail', async () => {
    throw new Error('Google token exchange failed (400)');
  });

  const agent = request.agent(getApp());
  const kickoffRes = await agent.get('/api/auth/oauth/google');
  const state = new URL(kickoffRes.headers.location).searchParams.get('state');

  const callbackRes = await agent.get(`/api/auth/oauth/google/callback?code=bad-code&state=${state}`);
  assert.strictEqual(callbackRes.status, 302);
  assert.match(decodeURIComponent(callbackRes.headers.location), /Google/);
});

test('GET /api/auth/me - reports which OAuth providers are actually configured', async () => {
  // GOOGLE_* configured in beforeEach, GITHUB_* is not.
  const res = await request(getApp()).get('/api/auth/me');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.oauthProviders.google, true);
  assert.strictEqual(res.body.oauthProviders.github, false);
});
