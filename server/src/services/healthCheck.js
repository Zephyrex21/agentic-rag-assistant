const { getSupabase } = require('../db/supabaseClient');
const pinecone = require('./pinecone');
const { getClient: getGroqClient } = require('./groqClient');
const { parseIntEnv } = require('../utils/envConfig');

// Deliberately short - this only runs when a person explicitly asks for it
// (?deep=true), but it should still never let one slow/hanging provider
// make the health check itself hang. A real outage should report FAST as
// "not connected", not sit there for the default request timeout.
const DEEP_CHECK_TIMEOUT_MS = parseIntEnv('HEALTH_DEEP_CHECK_TIMEOUT_MS', 5000, { min: 100 });

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs one named check, never throwing - every possible failure (missing
 * config, network error, timeout, an unexpected SDK shape) becomes
 * `{ connected: false, error: <message> }` instead of rejecting, so a
 * single provider being down can never take out the whole deep-health
 * response or produce a 500 for what's fundamentally a diagnostic
 * endpoint.
 */
async function runCheck(fn) {
  const start = Date.now();
  try {
    const extra = await withTimeout(fn(), DEEP_CHECK_TIMEOUT_MS);
    return { connected: true, latencyMs: Date.now() - start, ...extra };
  } catch (err) {
    return { connected: false, latencyMs: Date.now() - start, error: err.message };
  }
}

/**
 * Real connectivity checks for Supabase/Pinecone/Groq - distinct from
 * /health's default env-var-presence check, which can only ever say
 * "configured", never "actually reachable with these exact credentials".
 * Deliberately NOT run on every /health request (see app.js) - only when
 * a person explicitly opts in with ?deep=true, since hosting platforms and
 * uptime monitors often poll /health every few seconds and a live call
 * against every provider on that cadence would be wasteful and, worse,
 * would burn real API quota for no benefit.
 *
 * Jina has no cheap read-only endpoint to check the same way (the only
 * operation it exposes is embedding text, which costs real quota) - its
 * result here is intentionally just the same key-presence check /health
 * already does, not a live call, with a note explaining why.
 */
async function checkDeepHealth() {
  const [supabase, pineconeResult, groq] = await Promise.all([
    runCheck(async () => {
      const client = getSupabase();
      const { error } = await client.from('documents').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) throw new Error(error.message);
      return {};
    }),
    runCheck(async () => pinecone.checkConnection()),
    runCheck(async () => {
      const client = getGroqClient();
      // models.list() is a lightweight, read-only call on Groq's
      // OpenAI-compatible API - it doesn't consume generation/completion
      // quota, just confirms the API key is valid and Groq is reachable.
      const result = await client.models.list();
      const count = Array.isArray(result?.data) ? result.data.length : undefined;
      return count !== undefined ? { modelsAvailable: count } : {};
    }),
  ]);

  return {
    supabase,
    pinecone: pineconeResult,
    groq,
    jina: {
      configured: Boolean(process.env.JINA_API_KEY),
      note: 'Jina has no cheap read-only endpoint to verify against - this reflects key presence only, not a live connectivity check (embedding a real request would cost quota).',
    },
  };
}

module.exports = { checkDeepHealth, DEEP_CHECK_TIMEOUT_MS };
