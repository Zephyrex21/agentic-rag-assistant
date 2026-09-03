const test = require('node:test');
const assert = require('node:assert');

const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'];
let savedEnv;

test.beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

test('isValidProvider only recognizes the two registered providers', () => {
  const oauthProviders = require('../src/services/oauthProviders');
  assert.strictEqual(oauthProviders.isValidProvider('google'), true);
  assert.strictEqual(oauthProviders.isValidProvider('github'), true);
  assert.strictEqual(oauthProviders.isValidProvider('facebook'), false);
  assert.strictEqual(oauthProviders.isValidProvider('__proto__'), false, 'FAIL: must not resolve prototype properties as a "provider"');
});

test('isProviderConfigured requires BOTH client id and secret for a provider', () => {
  const oauthProviders = require('../src/services/oauthProviders');
  assert.strictEqual(oauthProviders.isProviderConfigured('google'), false);

  process.env.GOOGLE_CLIENT_ID = 'id';
  assert.strictEqual(oauthProviders.isProviderConfigured('google'), false, 'FAIL: secret alone missing should not count as configured');

  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  assert.strictEqual(oauthProviders.isProviderConfigured('google'), true);
  assert.strictEqual(oauthProviders.isProviderConfigured('github'), false, 'FAIL: configuring google must not also mark github as configured');
});

test('buildAuthorizeUrl includes the state, redirect_uri, and client_id for Google', () => {
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  const oauthProviders = require('../src/services/oauthProviders');

  const url = new URL(oauthProviders.buildAuthorizeUrl('google', 'abc123state', 'https://backend.example.com/api/auth/oauth/google/callback'));
  assert.strictEqual(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(url.searchParams.get('client_id'), 'test-google-client-id');
  assert.strictEqual(url.searchParams.get('state'), 'abc123state');
  assert.strictEqual(url.searchParams.get('redirect_uri'), 'https://backend.example.com/api/auth/oauth/google/callback');
  assert.strictEqual(url.searchParams.get('response_type'), 'code');
});

test('buildAuthorizeUrl includes the state, redirect_uri, and client_id for GitHub', () => {
  process.env.GITHUB_CLIENT_ID = 'test-github-client-id';
  const oauthProviders = require('../src/services/oauthProviders');

  const url = new URL(oauthProviders.buildAuthorizeUrl('github', 'xyz789state', 'https://backend.example.com/api/auth/oauth/github/callback'));
  assert.strictEqual(url.origin + url.pathname, 'https://github.com/login/oauth/authorize');
  assert.strictEqual(url.searchParams.get('client_id'), 'test-github-client-id');
  assert.strictEqual(url.searchParams.get('state'), 'xyz789state');
});

test('exchangeCodeForEmail (google) - exchanges the code, fetches the profile, and returns the verified email', async (t) => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const oauthProviders = require('../src/services/oauthProviders');

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    if (String(url).includes('googleapis.com/oauth2/v3/userinfo')) {
      return new Response(JSON.stringify({ email: 'person@example.com', email_verified: true }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const email = await oauthProviders.exchangeCodeForEmail('google', 'test-code', 'https://backend.example.com/callback');
  assert.strictEqual(email, 'person@example.com');
});

test('exchangeCodeForEmail (google) - rejects an unverified email rather than creating an account from it', async (t) => {
  process.env.GOOGLE_CLIENT_ID = 'id';
  process.env.GOOGLE_CLIENT_SECRET = 'secret';
  const oauthProviders = require('../src/services/oauthProviders');

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    return new Response(JSON.stringify({ email: 'unverified@example.com', email_verified: false }), { status: 200 });
  });

  await assert.rejects(() => oauthProviders.exchangeCodeForEmail('google', 'code', 'https://backend.example.com/callback'));
});

test('exchangeCodeForEmail (github) - falls back to /user/emails and picks the primary VERIFIED address', async (t) => {
  process.env.GITHUB_CLIENT_ID = 'id';
  process.env.GITHUB_CLIENT_SECRET = 'secret';
  const oauthProviders = require('../src/services/oauthProviders');

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'test-access-token' }), { status: 200 });
    }
    if (String(url).includes('api.github.com/user/emails')) {
      return new Response(
        JSON.stringify([
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'unverified-primary@example.com', primary: true, verified: false },
          { email: 'primary-verified@example.com', primary: true, verified: true },
        ]),
        { status: 200 }
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const email = await oauthProviders.exchangeCodeForEmail('github', 'test-code', 'https://backend.example.com/callback');
  assert.strictEqual(email, 'primary-verified@example.com');
});

test('exchangeCodeForEmail (github) - throws when no verified primary email exists', async (t) => {
  process.env.GITHUB_CLIENT_ID = 'id';
  process.env.GITHUB_CLIENT_SECRET = 'secret';
  const oauthProviders = require('../src/services/oauthProviders');

  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('access_token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
    return new Response(JSON.stringify([{ email: 'unverified@example.com', primary: true, verified: false }]), { status: 200 });
  });

  await assert.rejects(() => oauthProviders.exchangeCodeForEmail('github', 'code', 'https://backend.example.com/callback'));
});

test('exchangeCodeForEmail (github) - a token-exchange error response throws with the provider message included', async (t) => {
  process.env.GITHUB_CLIENT_ID = 'id';
  process.env.GITHUB_CLIENT_SECRET = 'secret';
  const oauthProviders = require('../src/services/oauthProviders');

  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }), { status: 200 }));

  await assert.rejects(
    () => oauthProviders.exchangeCodeForEmail('github', 'stale-code', 'https://backend.example.com/callback'),
    (err) => {
      assert.match(err.message, /incorrect or expired/);
      return true;
    }
  );
});
