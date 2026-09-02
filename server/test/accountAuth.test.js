const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const userStore = require('../src/db/userStore');
const otpStore = require('../src/db/otpStore');
const emailService = require('../src/services/emailService');
const otp = require('../src/services/otp');
const app = require('../src/app');

// Regression/behavior coverage for the passwordless email-OTP account
// system (see routes/auth.js, services/otp.js, services/emailService.js).
// Guest mode (no account at all) is covered implicitly by every OTHER
// route test file in this suite, which never send a session cookie and
// still work - these tests are specifically about the account layer.

test('POST /api/auth/otp/request - rejects an invalid email', async () => {
  const res = await request(app).post('/api/auth/otp/request').send({ email: 'not-an-email' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_EMAIL');
});

test('POST /api/auth/otp/request - generates a code, emails it, and stores only its hash', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => null); // no pending code - no cooldown to check
  let storedArgs = null;
  t.mock.method(otpStore, 'upsert', async (args) => {
    storedArgs = args;
  });
  let sentCode = null;
  t.mock.method(emailService, 'sendOtpEmail', async (_email, code) => {
    sentCode = code;
  });

  const res = await request(app).post('/api/auth/otp/request').send({ email: 'new@example.com' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.sent, true);
  assert.match(sentCode, /^\d{6}$/, 'FAIL: expected a 6-digit numeric code');
  assert.strictEqual(storedArgs.email, 'new@example.com');
  assert.strictEqual(storedArgs.codeHash, otp.hashCode(sentCode), 'FAIL: the stored hash must match the emailed code');
  assert.notStrictEqual(storedArgs.codeHash, sentCode, 'FAIL: the raw code itself must never be what gets stored');
});

test('POST /api/auth/otp/request - a database failure (e.g. missing migration) is reported as OTP_STORE_FAILED, distinct from an email failure', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => null);
  t.mock.method(otpStore, 'upsert', async () => {
    throw new Error('relation "otp_codes" does not exist');
  });
  let emailAttempted = false;
  t.mock.method(emailService, 'sendOtpEmail', async () => {
    emailAttempted = true;
  });

  const res = await request(app).post('/api/auth/otp/request').send({ email: 'new@example.com' });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error.code, 'OTP_STORE_FAILED');
  assert.match(res.body.error.message, /migration_008/, 'FAIL: a missing-table error should point at the migration to run');
  assert.strictEqual(emailAttempted, false, 'FAIL: should never attempt to send an email for a code that was never stored');
});

test('POST /api/auth/otp/request - an email-send failure (e.g. bad SMTP creds) is reported as OTP_EMAIL_FAILED, not OTP_STORE_FAILED', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => null);
  t.mock.method(otpStore, 'upsert', async () => {});
  t.mock.method(emailService, 'sendOtpEmail', async () => {
    throw new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
  });

  const res = await request(app).post('/api/auth/otp/request').send({ email: 'new@example.com' });
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error.code, 'OTP_EMAIL_FAILED');
  assert.match(res.body.error.message, /SMTP/i);
});

test('POST /api/auth/otp/request - a second request for the same email within the cooldown is rejected with 429', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'new@example.com',
    codeHash: 'irrelevant',
    attempts: 0,
    createdAt: new Date().toISOString(), // just created - well within the cooldown
  }));
  t.mock.method(otpStore, 'upsert', async () => {
    throw new Error('FAIL: should not attempt to issue a new code inside the cooldown window');
  });
  t.mock.method(emailService, 'sendOtpEmail', async () => {
    throw new Error('FAIL: should not send an email inside the cooldown window');
  });

  const res = await request(app).post('/api/auth/otp/request').send({ email: 'new@example.com' });
  assert.strictEqual(res.status, 429);
  assert.strictEqual(res.body.error.code, 'OTP_RESEND_TOO_SOON');
});

test('POST /api/auth/otp/verify - rejects a malformed code before touching the store', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => {
    throw new Error('FAIL: should not look up a code for an invalid submission');
  });

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'real@example.com', code: 'abc123' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_CODE');
});

test('POST /api/auth/otp/verify - no pending code for this email returns OTP_NOT_FOUND', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => null);

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'real@example.com', code: '123456' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'OTP_NOT_FOUND');
});

test('POST /api/auth/otp/verify - an expired code is rejected and cleaned up', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'real@example.com',
    codeHash: otp.hashCode('123456'),
    attempts: 0,
    expiresAt: new Date(Date.now() - 1000).toISOString(), // already in the past
  }));
  let deletedEmail = null;
  t.mock.method(otpStore, 'deleteByEmail', async (email) => {
    deletedEmail = email;
  });

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'real@example.com', code: '123456' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'OTP_EXPIRED');
  assert.strictEqual(deletedEmail, 'real@example.com', 'FAIL: an expired code should be cleaned up, not left around');
});

test('POST /api/auth/otp/verify - the wrong code is rejected and counted as an attempt (account never enumerated)', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'real@example.com',
    codeHash: otp.hashCode('123456'),
    attempts: 1,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  let incrementedEmail = null;
  t.mock.method(otpStore, 'incrementAttempts', async (email) => {
    incrementedEmail = email;
    return 2;
  });

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'real@example.com', code: '999999' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'OTP_INCORRECT');
  assert.strictEqual(res.body.error.attemptsRemaining, 3); // MAX_ATTEMPTS (5) - 2
  assert.strictEqual(incrementedEmail, 'real@example.com');
});

test('POST /api/auth/otp/verify - hitting the attempt limit invalidates the code entirely', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'real@example.com',
    codeHash: otp.hashCode('123456'),
    attempts: 4, // one more wrong guess reaches MAX_ATTEMPTS (5)
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  t.mock.method(otpStore, 'incrementAttempts', async () => 5);
  let deletedEmail = null;
  t.mock.method(otpStore, 'deleteByEmail', async (email) => {
    deletedEmail = email;
  });

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'real@example.com', code: '999999' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'OTP_TOO_MANY_ATTEMPTS');
  assert.strictEqual(deletedEmail, 'real@example.com');
});

test('POST /api/auth/otp/verify - the correct code signs in (creating the account on a first-time email), returns a bearer token, AND sets a session cookie', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'new@example.com',
    codeHash: otp.hashCode('123456'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  let deletedEmail = null;
  t.mock.method(otpStore, 'deleteByEmail', async (email) => {
    deletedEmail = email;
  });
  t.mock.method(userStore, 'findOrCreateByEmail', async (email) => ({ id: 'user-1', email, createdAt: 'now' }));

  const res = await request(app).post('/api/auth/otp/verify').send({ email: 'new@example.com', code: '123456' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.email, 'new@example.com');
  assert.strictEqual(deletedEmail, 'new@example.com', 'FAIL: a successfully-used code must be consumed, not reusable');
  assert.strictEqual(typeof res.body.token, 'string', 'FAIL: expected a bearer token in the response body');
  assert.ok(res.body.token.length > 0);
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  assert.ok(setCookie.includes('session='), 'FAIL: expected a session cookie to be set');
  assert.ok(/HttpOnly/i.test(setCookie), 'FAIL: the session cookie must be HttpOnly');
});

test('POST /api/auth/logout - clears the session cookie', async () => {
  const res = await request(app).post('/api/auth/logout');
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  // A cleared cookie is sent back with an expiry in the past / empty value
  assert.ok(setCookie.includes('session=;') || setCookie.includes('session='), 'FAIL: expected the session cookie to be cleared');
});

test('GET /api/auth/me - reports null for a guest (no cookie sent)', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user, null);
});

test('GET /api/auth/me - reports the logged-in user for a valid session cookie', async (t) => {
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'real@example.com' }));

  const { signToken } = require('../src/services/authTokens');
  const token = signToken('user-1');

  const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.id, 'user-1');
  assert.strictEqual(res.body.user.email, 'real@example.com');
});

// Regression coverage for a real bug: on this app's cross-origin
// deployment shape (frontend and backend on separate domains), the
// session COOKIE is silently never sent back on requests from the
// frontend at all (SameSite=Lax blocks it for cross-site fetches) - a
// person could complete OTP verification successfully, reload, and still
// show up as a guest. The fix is the Authorization header path in
// middleware/userAuth.js; this test exercises that path with NO cookie
// present at all, the same as a real cross-origin request would look.
test('GET /api/auth/me - reports the logged-in user from an Authorization: Bearer header, with no cookie at all', async (t) => {
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'real@example.com' }));

  const { signToken } = require('../src/services/authTokens');
  const token = signToken('user-1');

  const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.id, 'user-1');
  assert.strictEqual(res.body.user.email, 'real@example.com');
});

test('GET /api/auth/me - the Authorization header wins if both it and a (different, e.g. stale) cookie are present', async (t) => {
  t.mock.method(userStore, 'findById', async (id) => (id === 'user-fresh' ? { id, email: 'fresh@example.com' } : null));

  const { signToken } = require('../src/services/authTokens');
  const freshToken = signToken('user-fresh');
  const staleToken = signToken('user-stale-deleted');

  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${freshToken}`)
    .set('Cookie', `session=${staleToken}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.email, 'fresh@example.com', 'FAIL: the header should take priority over the cookie');
});

test('POST /api/auth/otp/verify -> the returned token immediately works as a Bearer header on the very next request (full flow, no cookie involved)', async (t) => {
  t.mock.method(otpStore, 'findByEmail', async () => ({
    email: 'new@example.com',
    codeHash: otp.hashCode('123456'),
    attempts: 0,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  }));
  t.mock.method(otpStore, 'deleteByEmail', async () => {});
  t.mock.method(userStore, 'findOrCreateByEmail', async (email) => ({ id: 'user-1', email, createdAt: 'now' }));
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'new@example.com' }));

  const verifyRes = await request(app).post('/api/auth/otp/verify').send({ email: 'new@example.com', code: '123456' });
  const { token } = verifyRes.body;

  // Deliberately a brand-new request with NO cookie jar shared with the
  // call above - this is exactly what a page reload on a different origin
  // than the backend looks like from the server's point of view.
  const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.strictEqual(meRes.status, 200);
  assert.strictEqual(meRes.body.user.email, 'new@example.com');
});

test('GET /api/auth/me - a cookie for a since-deleted account resolves as a guest, not an error', async (t) => {
  t.mock.method(userStore, 'findById', async () => null);

  const { signToken } = require('../src/services/authTokens');
  const token = signToken('deleted-user-id');

  const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user, null);
});
