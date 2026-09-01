const nodemailer = require('nodemailer');
const { parseIntEnv } = require('../utils/envConfig');

let transporter = null;
let loggedDevModeWarning = false;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseIntEnv('SMTP_PORT', 587),
      // true for port 465 (implicit TLS), false for 587/others (STARTTLS,
      // which nodemailer negotiates automatically) - see .env.example.
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

/**
 * Sends the OTP sign-in code by email - or, if SMTP isn't configured
 * (SMTP_HOST/SMTP_USER/SMTP_PASS unset), logs it to the server console
 * instead. That fallback exists specifically so this whole feature works
 * out of the box in local dev with zero email-provider setup, matching
 * this project's existing "missing optional config = the feature quietly
 * degrades instead of hard-failing" pattern elsewhere (e.g. MISTRAL_API_KEY
 * in .env.example). This is a LOCAL-DEV convenience only, never something
 * to leave relied-on in a real deployment - anyone with server log access
 * (not just the account holder) could read every code, which defeats the
 * entire point of emailing it. See the SMTP_HOST comment in .env.example.
 */
async function sendOtpEmail(email, code) {
  if (!isConfigured()) {
    if (!loggedDevModeWarning) {
      console.warn(
        '[email] SMTP is not configured - OTP codes will be logged to the console instead of emailed. ' +
          'Set SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM in server/.env before deploying anywhere real users will sign in.'
      );
      loggedDevModeWarning = true;
    }
    console.log(`[email] (dev mode, not actually sent) OTP code for ${email}: ${code}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  await getTransporter().sendMail({
    from,
    to: email,
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
  });
}

module.exports = { sendOtpEmail, isConfigured };
