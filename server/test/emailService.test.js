const test = require('node:test');
const assert = require('node:assert');

const ENV_KEYS = ['SENDGRID_API_KEY', 'SENDGRID_FROM', 'RESEND_API_KEY', 'RESEND_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
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

test('sendOtpEmail - prefers SendGrid (works without a domain) over both Resend and SMTP when all are configured', async (t) => {
  process.env.SENDGRID_API_KEY = 'test-sendgrid-key';
  process.env.SENDGRID_FROM = 'me@gmail.com';
  process.env.RESEND_API_KEY = 'test-resend-key'; // also configured - SendGrid must still win
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';

  let capturedUrl = null;
  let capturedInit = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response('{}', { status: 202 });
  });

  const emailService = require('../src/services/emailService');
  await emailService.sendOtpEmail('anyone@example.com', '123456');

  assert.strictEqual(capturedUrl, 'https://api.sendgrid.com/v3/mail/send');
  assert.strictEqual(capturedInit.headers.Authorization, 'Bearer test-sendgrid-key');
  const body = JSON.parse(capturedInit.body);
  assert.strictEqual(body.personalizations[0].to[0].email, 'anyone@example.com');
  assert.strictEqual(body.from.email, 'me@gmail.com');
  assert.match(body.content.find((c) => c.type === 'text/plain').value, /123456/);
});

test('sendOtpEmail - SendGrid without SENDGRID_FROM is not considered configured (falls through to Resend)', async (t) => {
  process.env.SENDGRID_API_KEY = 'test-sendgrid-key'; // FROM deliberately left unset
  process.env.RESEND_API_KEY = 'test-resend-key';

  let capturedUrl = null;
  t.mock.method(globalThis, 'fetch', async (url) => {
    capturedUrl = url;
    return new Response('{}', { status: 200 });
  });

  const emailService = require('../src/services/emailService');
  assert.strictEqual(emailService.sendgridConfigured(), false);
  await emailService.sendOtpEmail('anyone@example.com', '123456');
  assert.strictEqual(capturedUrl, 'https://api.resend.com/emails');
});

test('sendOtpEmail - a non-2xx SendGrid response throws with the response body included', async (t) => {
  process.env.SENDGRID_API_KEY = 'test-sendgrid-key';
  process.env.SENDGRID_FROM = 'me@gmail.com';
  t.mock.method(globalThis, 'fetch', async () => new Response('{"errors":[{"message":"does not match a verified Sender Identity"}]}', { status: 403, statusText: 'Forbidden' }));

  const emailService = require('../src/services/emailService');
  await assert.rejects(
    () => emailService.sendOtpEmail('anyone@example.com', '123456'),
    (err) => {
      assert.match(err.message, /403/);
      assert.match(err.message, /verified Sender Identity/);
      return true;
    }
  );
});

test('sendOtpEmail - prefers Resend (a plain HTTPS call) over SMTP when both are configured', async (t) => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.SMTP_HOST = 'smtp.example.com'; // also configured - Resend must still win
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';

  let capturedUrl = null;
  let capturedInit = null;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response('{}', { status: 200 });
  });

  const emailService = require('../src/services/emailService');
  await emailService.sendOtpEmail('person@example.com', '123456');

  assert.strictEqual(capturedUrl, 'https://api.resend.com/emails');
  assert.strictEqual(capturedInit.headers.Authorization, 'Bearer test-resend-key');
  const body = JSON.parse(capturedInit.body);
  assert.deepStrictEqual(body.to, ['person@example.com']);
  assert.match(body.text, /123456/, 'FAIL: the code itself must be in the email content');
  assert.strictEqual(body.from, 'RAG Assistant <onboarding@resend.dev>', 'FAIL: expected the default Resend sender when RESEND_FROM is unset');
});

test('sendOtpEmail - a non-2xx Resend response throws with the response body included', async (t) => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  t.mock.method(globalThis, 'fetch', async () => new Response('{"message":"invalid API key"}', { status: 401, statusText: 'Unauthorized' }));

  const emailService = require('../src/services/emailService');
  await assert.rejects(
    () => emailService.sendOtpEmail('person@example.com', '123456'),
    (err) => {
      assert.match(err.message, /401/);
      assert.match(err.message, /invalid API key/);
      return true;
    }
  );
});

test('sendOtpEmail - falls back to SMTP when RESEND_API_KEY is not set but SMTP is', async (t) => {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';

  const fetchSpy = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('FAIL: should not call Resend/fetch when only SMTP is configured');
  });

  const nodemailer = require('nodemailer');
  let sentMail = null;
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (mail) => {
      sentMail = mail;
    },
  }));

  const emailService = require('../src/services/emailService');
  await emailService.sendOtpEmail('person@example.com', '654321');

  assert.strictEqual(fetchSpy.mock.callCount(), 0);
  assert.strictEqual(sentMail.to, 'person@example.com');
  assert.match(sentMail.text, /654321/);
});

test('sendOtpEmail - with neither provider configured, does not throw (dev-mode console fallback)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('FAIL: should not call fetch when no email provider is configured');
  });

  const emailService = require('../src/services/emailService');
  await assert.doesNotReject(() => emailService.sendOtpEmail('person@example.com', '111111'));
});

test('isConfigured / sendgridConfigured / resendConfigured / smtpConfigured reflect the current env correctly', () => {
  const emailService = require('../src/services/emailService');

  assert.strictEqual(emailService.isConfigured(), false);

  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';
  assert.strictEqual(emailService.smtpConfigured(), true);
  assert.strictEqual(emailService.sendgridConfigured(), false);
  assert.strictEqual(emailService.resendConfigured(), false);
  assert.strictEqual(emailService.isConfigured(), true);

  delete process.env.SMTP_PASS; // one of three required SMTP vars missing
  assert.strictEqual(emailService.smtpConfigured(), false);

  process.env.SENDGRID_API_KEY = 'key';
  assert.strictEqual(emailService.sendgridConfigured(), false, 'FAIL: SendGrid needs SENDGRID_FROM too, not just the key');
  process.env.SENDGRID_FROM = 'me@gmail.com';
  assert.strictEqual(emailService.sendgridConfigured(), true);
});
