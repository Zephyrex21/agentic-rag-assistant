const Cerebras = require('@cerebras/cerebras_cloud_sdk');

/**
 * Cerebras client - used exclusively as a PROVIDER-level fallback (see
 * withProviderFallback in modelFallback.js), not a primary path. If Groq
 * itself is down, rate-limited, or otherwise unreachable - not just a
 * single decommissioned model - this is what keeps answers flowing instead
 * of the whole app going dark. Genuinely free tier, OpenAI-compatible API -
 * see llm.js for which model is used there (Cerebras's free public catalog
 * is deliberately small, check https://inference-docs.cerebras.ai/models/overview
 * before changing it).
 *
 * This is optional: if CEREBRAS_API_KEY is unset, provider fallback is
 * simply skipped and the app behaves as it did before this was added.
 */

let client = null;
let attempted = false;

function getClient() {
  if (!process.env.CEREBRAS_API_KEY) return null;
  if (!client && !attempted) {
    attempted = true;
    client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });
  }
  return client;
}

module.exports = { getClient };
