const nodemailer = require('nodemailer');
const { parseIntEnv } = require('../utils/envConfig');

const RESEND_API_URL = 'https://api.resend.com/emails';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

let smtpTransporter = null;
let loggedDevModeWarning = false;

// Trimmed - copy-pasting a value into a host's env var UI picking up a
// stray leading/trailing space or newline is a genuinely common way for
// "I definitely typed this right" credentials to still fail, and it fails
// SILENTLY (no clear "invalid character" error, just a rejected request) -
// trimming here removes an entire class of "it must be my key" debugging
// dead ends for free.
function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : value;
}

// SendGrid needs BOTH a key and a from-address - unlike Resend, which has
// a working shared default sender (onboarding@resend.dev) for the
// no-domain case, SendGrid has no such fallback: sending requires a
// Verified Sender Identity, which for a no-domain setup means the exact
// address you ran Single Sender Verification for (see SENDGRID_FROM's
// comment in .env.example) - there's no generic address that would work.
function sendgridConfigured() {
  return Boolean(readEnv('SENDGRID_API_KEY') && readEnv('SENDGRID_FROM'));
}

function resendConfigured() {
  return Boolean(readEnv('RESEND_API_KEY'));
}

function smtpConfigured() {
  return Boolean(readEnv('SMTP_HOST') && readEnv('SMTP_USER') && readEnv('SMTP_PASS'));
}

function isConfigured() {
  return sendgridConfigured() || resendConfigured() || smtpConfigured();
}

function otpEmailContent(code) {
  return {
    subject: `${code} is your RAG Assistant sign-in code`,
    text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 420px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
        <p style="font-size: 14px; color: #6b6b6b; margin: 0 0 8px;">RAG Assistant</p>
        <h1 style="font-size: 20px; margin: 0 0 20px;">Your sign-in code</h1>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; background: #f4f4f4; border-radius: 10px; padding: 16px 20px; text-align: center; margin-bottom: 20px;">${code}</div>
        <p style="font-size: 13px; color: #6b6b6b; line-height: 1.5;">
          This code expires in 10 minutes. If you didn't request this, you can safely ignore this email - no account changes were made.
        </p>
      </div>
    `,
  };
}

/**
 * SendGrid's "Single Sender Verification" is the one option here that
 * doesn't need a domain AND doesn't restrict who you can send TO (unlike
 * Resend's no-domain sandbox mode, which only delivers to the account's
 * own signup address - a hard product restriction, not a config option).
 * You verify ONE email address you already own (a personal Gmail address
 * is fine) as your sender identity in the SendGrid dashboard, and from
 * then on can send to any recipient. See SENDGRID_FROM's comment in
 * .env.example for the exact setup steps.
 */
async function sendViaSendgrid(email, code) {
  const { subject, text, html } = otpEmailContent(code);

  const res = await fetch(SENDGRID_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readEnv('SENDGRID_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: readEnv('SENDGRID_FROM'), name: 'RAG Assistant' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`SendGrid API responded ${res.status}: ${body || res.statusText}`);
  }
}

/**
 * Resend's API is a single HTTPS POST with a JSON body and an API-key
 * bearer header - no persistent connection, no protocol handshake, no
 * separate auth negotiation the way SMTP needs. Fast and reliable IF a
 * verified domain is configured - without one, Resend's shared
 * onboarding@resend.dev sender only delivers to the account's OWN signup
 * email (their anti-abuse sandbox restriction), which makes it unsuitable
 * for "any real user can sign in" without also owning a domain. See
 * sendViaSendgrid above for the no-domain alternative.
 */
async function sendViaResend(email, code) {
  const { subject, text, html } = otpEmailContent(code);
  const from = readEnv('RESEND_FROM') || 'RAG Assistant <onboarding@resend.dev>';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API responded ${res.status}: ${body || res.statusText}`);
  }
}

function getSmtpTransporter() {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: readEnv('SMTP_HOST'),
      port: parseIntEnv('SMTP_PORT', 587),
      // true for port 465 (implicit TLS), false for 587/others (STARTTLS,
      // which nodemailer negotiates automatically) - see .env.example.
      secure: readEnv('SMTP_SECURE') === 'true',
      auth: { user: readEnv('SMTP_USER'), pass: readEnv('SMTP_PASS') },
    });
  }
  return smtpTransporter;
}

async function sendViaSmtp(email, code) {
  const { subject, text, html } = otpEmailContent(code);
  const from = readEnv('SMTP_FROM') || readEnv('SMTP_USER');
  await getSmtpTransporter().sendMail({ from, to: email, subject, text, html });
}

/**
 * Sends the OTP sign-in code by email. Tries, in order:
 *   1. SendGrid (SENDGRID_API_KEY + SENDGRID_FROM set) - preferred when
 *      you DON'T own a domain, since it's the only one of the three that's
 *      both a fast HTTP API AND works for arbitrary recipients without one.
 *   2. Resend (RESEND_API_KEY set) - preferred instead once you DO own a
 *      verified domain (see RESEND_FROM's comment in .env.example);
 *      without one it can only deliver to the account's own signup email.
 *   3. SMTP (SMTP_HOST/SMTP_USER/SMTP_PASS all set) - a fallback for
 *      anyone who'd rather bring their own mail server/provider than sign
 *      up for either of the above. Works for any recipient regardless of
 *      domain ownership (it's just a normal email from your own address),
 *      just with more latency than an HTTP API call.
 *   4. None configured - logs the code to the server console instead of
 *      emailing it. That fallback exists specifically so this whole
 *      feature works out of the box in local dev with zero email-provider
 *      setup, matching this project's existing "missing optional config =
 *      the feature quietly degrades instead of hard-failing" pattern
 *      elsewhere (e.g. MISTRAL_API_KEY in .env.example). This is a
 *      LOCAL-DEV convenience only, never something to leave relied-on in a
 *      real deployment - anyone with server log access (not just the
 *      account holder) could read every code, which defeats the entire
 *      point of emailing it.
 *
 * Any failure here is intentionally left to throw straight out to the
 * caller (routes/auth.js) rather than being swallowed - that's what lets
 * the route tell the difference between "the DB write failed" and "the
 * email itself failed" and return a message that actually points at the
 * right thing to check.
 */
async function sendOtpEmail(email, code) {
  if (sendgridConfigured()) {
    return sendViaSendgrid(email, code);
  }
  if (resendConfigured()) {
    return sendViaResend(email, code);
  }
  if (smtpConfigured()) {
    return sendViaSmtp(email, code);
  }

  if (!loggedDevModeWarning) {
    console.warn(
      '[email] No email provider is configured (SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS) - ' +
        'OTP codes will be logged to the console instead of emailed. See .env.example before deploying anywhere ' +
        "real users will sign in - SendGrid's Single Sender Verification is the easiest option if you don't own a domain."
    );
    loggedDevModeWarning = true;
  }
  console.log(`[email] (dev mode, not actually sent) OTP code for ${email}: ${code}`);
}

module.exports = { sendOtpEmail, isConfigured, sendgridConfigured, resendConfigured, smtpConfigured };
