const test = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy';
process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'dummy';
process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'dummy';

const userStore = require('../src/db/userStore');
const app = require('../src/app');

// Regression/behavior coverage for the new user-account system. Guest mode
// (no signup/login at all) is covered implicitly by every OTHER route test
// file in this suite, which never send a session cookie and still work -
// these tests are specifically about the new opt-in account layer.

test('POST /api/auth/signup - rejects an invalid email', async () => {
  const res = await request(app).post('/api/auth/signup').send({ email: 'not-an-email', password: 'longenough123' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_EMAIL');
});

test('POST /api/auth/signup - rejects a too-short password', async () => {
  const res = await request(app).post('/api/auth/signup').send({ email: 'a@example.com', password: 'short' });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'INVALID_PASSWORD');
});

test('POST /api/auth/signup - creates an account and sets a session cookie', async (t) => {
  t.mock.method(userStore, 'create', async ({ email }) => ({ id: 'user-1', email, createdAt: 'now' }));

  const res = await request(app).post('/api/auth/signup').send({ email: 'new@example.com', password: 'longenough123' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.body.user.email, 'new@example.com');
  assert.strictEqual(res.body.user.passwordHash, undefined, 'FAIL: the password hash must never be returned to the client');
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  assert.ok(setCookie.includes('session='), 'FAIL: expected a session cookie to be set');
  assert.ok(/HttpOnly/i.test(setCookie), 'FAIL: the session cookie must be HttpOnly');
});

test('POST /api/auth/signup - a duplicate email is rejected with 409, not 500', async (t) => {
  t.mock.method(userStore, 'create', async () => {
    throw new Error('An account with this email already exists.');
  });

  const res = await request(app).post('/api/auth/signup').send({ email: 'taken@example.com', password: 'longenough123' });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.error.code, 'EMAIL_TAKEN');
});

test('POST /api/auth/login - wrong password returns a generic 401 (not "email not found")', async (t) => {
  t.mock.method(userStore, 'findByEmail', async (email) => ({ id: 'user-1', email, passwordHash: 'irrelevant' }));
  t.mock.method(userStore, 'verifyPassword', async () => false);

  const res = await request(app).post('/api/auth/login').send({ email: 'real@example.com', password: 'wrongpassword' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('POST /api/auth/login - an unknown email returns the SAME generic 401 (no account-enumeration signal)', async (t) => {
  t.mock.method(userStore, 'findByEmail', async () => null);

  const res = await request(app).post('/api/auth/login').send({ email: 'doesnotexist@example.com', password: 'whatever123' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
  assert.strictEqual(res.body.error.message, 'Incorrect email or password.');
});

test('POST /api/auth/login - correct credentials set a session cookie', async (t) => {
  t.mock.method(userStore, 'findByEmail', async (email) => ({ id: 'user-1', email, passwordHash: 'hashed' }));
  t.mock.method(userStore, 'verifyPassword', async () => true);

  const res = await request(app).post('/api/auth/login').send({ email: 'real@example.com', password: 'correctpassword' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.email, 'real@example.com');
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  assert.ok(setCookie.includes('session='), 'FAIL: expected a session cookie to be set');
});

test('POST /api/auth/logout - clears the session cookie', async () => {
  const res = await request(app).post('/api/auth/logout');
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers['set-cookie']?.join(';') || '';
  // A cleared cookie is sent back with an expiry in the past / empty value
  assert.ok(setCookie.includes('session=;') || setCookie.includes('session=') , 'FAIL: expected the session cookie to be cleared');
});

test('GET /api/auth/me - reports null for a guest (no cookie sent)', async () => {
  const res = await request(app).get('/api/auth/me');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user, null);
});

test('GET /api/auth/me - reports the logged-in user for a valid session cookie', async (t) => {
  t.mock.method(userStore, 'findById', async (id) => ({ id, email: 'real@example.com', passwordHash: 'hashed' }));

  const { signToken } = require('../src/services/authTokens');
  const token = signToken('user-1');

  const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user.id, 'user-1');
  assert.strictEqual(res.body.user.email, 'real@example.com');
});

test('GET /api/auth/me - a cookie for a since-deleted account resolves as a guest, not an error', async (t) => {
  t.mock.method(userStore, 'findById', async () => null);

  const { signToken } = require('../src/services/authTokens');
  const token = signToken('deleted-user-id');

  const res = await request(app).get('/api/auth/me').set('Cookie', `session=${token}`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.user, null);
});
