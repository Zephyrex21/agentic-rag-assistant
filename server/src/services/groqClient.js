const Groq = require('groq-sdk');

/**
 * Groq client factory.
 *
 * Unlike Gemini, Groq's rate limits apply at the ORGANIZATION level, not per
 * API key - generating multiple keys and rotating between them does nothing
 * for your quota (Groq's own docs are explicit about this). So unlike the
 * old geminiClient.js, there's no role-based key distribution here - one
 * shared key is genuinely all a multi-key setup would have bought you
 * anyway, just with extra config surface. If Groq ever changes this, revisit.
 */

let client = null;

function getClient() {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        'No API key available for Groq. Set GROQ_API_KEY in server/.env. ' +
          'Get a free key (no credit card required) at https://console.groq.com/keys'
      );
    }
    client = new Groq({ apiKey });
  }
  return client;
}

module.exports = { getClient };
