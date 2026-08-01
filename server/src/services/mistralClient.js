const OpenAI = require('openai');

/**
 * Mistral AI client - used exclusively as a PROVIDER-level fallback (see
 * withProviderFallback in modelFallback.js), not a primary path. If Groq
 * itself is down, rate-limited, or otherwise unreachable - not just a
 * single decommissioned model - this is what keeps answers flowing instead
 * of the whole app going dark.
 *
 * Picked over the earlier Cerebras choice deliberately: Mistral is a large,
 * well-funded AI lab (not a smaller platform where free-tier terms can
 * shift on short notice), free tier is genuinely no-card-required with a
 * very generous quota (~1B tokens/month as of this writing), and their API
 * is OpenAI-compatible at the wire level - so the standard `openai` SDK
 * works directly by pointing baseURL at Mistral instead of needing a
 * separate vendor SDK (that's also why this reads like a Groq client -
 * same shape on purpose).
 *
 * Nothing here is bulletproof forever - if Mistral's terms ever change the
 * way Cerebras's did, this is a one-file, one-provider swap, not a
 * rearchitecture. This is optional: if MISTRAL_API_KEY is unset, provider
 * fallback is simply skipped and the app behaves as if this file didn't
 * exist.
 */

let client = null;
let attempted = false;

function getClient() {
  if (!process.env.MISTRAL_API_KEY) return null;
  if (!client && !attempted) {
    attempted = true;
    client = new OpenAI({
      apiKey: process.env.MISTRAL_API_KEY,
      baseURL: 'https://api.mistral.ai/v1',
    });
  }
  return client;
}

module.exports = { getClient };
