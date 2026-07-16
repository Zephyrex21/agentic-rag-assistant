const { GoogleGenAI } = require('@google/genai');

/**
 * Role-based Gemini client factory. Distributes load across up to 3 separate
 * API keys so heavy embedding traffic can't starve answer generation, and
 * the new rewrite/rerank calls (Phase 6) don't compete with either.
 *
 * Each role falls back to GEMINI_API_KEY if its specific key isn't set, so
 * a single-key setup (Phase 1-5 style) keeps working unchanged - multi-key
 * is an upgrade you opt into, not a requirement.
 *
 * Roles:
 *   embedding  - called most often (every chunk on ingest, every query)
 *   generation - the main answer - gets a dedicated key so it's never
 *                starved by embedding or utility traffic
 *   utility    - query rewriting + reranking (Phase 6, lighter/cheaper calls)
 */

const ROLE_ENV_VARS = {
  embedding: 'GEMINI_API_KEY_EMBEDDING',
  generation: 'GEMINI_API_KEY_GENERATION',
  utility: 'GEMINI_API_KEY_UTILITY',
};

const clients = {};

function resolveApiKey(role) {
  const roleSpecific = process.env[ROLE_ENV_VARS[role]];
  if (roleSpecific) return roleSpecific;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  return null;
}

/**
 * @param {'embedding'|'generation'|'utility'} role
 */
function getClient(role) {
  if (!ROLE_ENV_VARS[role]) {
    throw new Error(`Unknown Gemini client role: "${role}". Expected one of: ${Object.keys(ROLE_ENV_VARS).join(', ')}`);
  }

  if (!clients[role]) {
    const apiKey = resolveApiKey(role);
    if (!apiKey) {
      throw new Error(
        `No API key available for the "${role}" Gemini client. Set ${ROLE_ENV_VARS[role]} for a dedicated key, ` +
          `or GEMINI_API_KEY as a shared fallback. Get a free key at https://aistudio.google.com/apikey`
      );
    }
    clients[role] = new GoogleGenAI({ apiKey });
  }

  return clients[role];
}

/**
 * True only when the person has actually configured a distinct key for this
 * role (not just falling back to the shared one). Useful for a startup log
 * line confirming the distribution is real, not silently sharing one key.
 */
function hasDedicatedKey(role) {
  return Boolean(process.env[ROLE_ENV_VARS[role]]);
}

module.exports = { getClient, hasDedicatedKey };
