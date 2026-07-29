require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

/**
 * Standalone diagnostic for the exact error:
 *   "Request had invalid authentication credentials. Expected OAuth 2
 *    access token, login cookie or other valid authentication credential."
 *
 * This bypasses the whole app (Express, ingestion pipeline, etc.) and talks
 * to Gemini directly with the SAME key resolution logic geminiClient.js
 * uses, so a pass/fail here tells you definitively whether the problem is
 * local config or something on Google's side with the key itself.
 *
 * Run with: npm run diagnose:gemini
 */

function mask(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return key[0] + '***';
  return `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} chars)`;
}

function keyTypeHint(key) {
  if (!key) return null;
  if (key.startsWith('AIzaSy')) return 'Standard key (AIza... format)';
  if (key.startsWith('AQ.')) {
    return 'Auth key (AQ. format) - the NEW key type Google AI Studio now issues by default. ' +
      'There is a known, ongoing Google-side rollout issue where some AQ. keys get rejected with ' +
      'exactly the OAuth error you saw, even when everything is configured correctly. See the chat for details.';
  }
  return `Unrecognized prefix ("${key.slice(0, 6)}...") - double check the full key was copied correctly (no quotes, no trailing space).`;
}

const ENV_VARS_THAT_FORCE_OAUTH_MODE = [
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_ENTERPRISE',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
];

const KEY_ENV_VARS = [
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_EMBEDDING',
  'GEMINI_API_KEY_GENERATION',
  'GEMINI_API_KEY_UTILITY',
  'GOOGLE_API_KEY',
];

async function testEmbedCall(label, key) {
  console.log(`\n--- Live test: ${label} ---`);
  if (!key) {
    console.log('  Skipped - no key resolved for this role.');
    return;
  }
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.embedContent({
      model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
      contents: ['diagnostic test string'],
      config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 },
    });
    const dims = res.embeddings?.[0]?.values?.length ?? 0;
    console.log(`  \u2705 SUCCESS - received a ${dims}-dimension vector back. This key/role works fine.`);
  } catch (err) {
    console.log('  \u274c FAILED');
    console.log(`     message: ${err.message}`);
    if (err.status !== undefined) console.log(`     status:  ${err.status}`);
    if (err.code !== undefined) console.log(`     code:    ${err.code}`);
    if (/OAuth 2 access token/i.test(err.message || '')) {
      console.log('     ^ This is the exact OAuth-credential-mismatch error from the chat.');
      console.log('       Since this call bypassed the whole app, this confirms the issue is the key/Google account itself, not the project code.');
    }
  }
}

(async () => {
  console.log('=== Gemini Key & Environment Diagnostic ===');

  console.log('\n--- Step 1: env vars that can silently force Vertex AI / OAuth mode ---');
  console.log('(all of these should be "(unset)" for a normal Gemini Developer API key setup)');
  let anyForcedOAuth = false;
  for (const k of ENV_VARS_THAT_FORCE_OAUTH_MODE) {
    const v = process.env[k];
    if (v) anyForcedOAuth = true;
    console.log(`  ${k} = ${v ? `"${v}"  <-- SET, this can force OAuth/Vertex mode!` : '(unset - good)'}`);
  }

  console.log('\n--- Step 2: resolved API key values (masked) ---');
  for (const k of KEY_ENV_VARS) {
    const v = process.env[k];
    const hint = v ? keyTypeHint(v) : '';
    console.log(`  ${k} = ${mask(v)}`);
    if (hint) console.log(`    -> ${hint}`);
  }

  console.log('\n--- Step 3: live call using the same key the embedding role would use ---');
  const embeddingKey = process.env.GEMINI_API_KEY_EMBEDDING || process.env.GEMINI_API_KEY;
  await testEmbedCall('embedding role (GEMINI_API_KEY_EMBEDDING, falling back to GEMINI_API_KEY)', embeddingKey);

  console.log('\n=== Summary ===');
  if (anyForcedOAuth) {
    console.log('You have a GOOGLE_*/GOOGLE_APPLICATION_CREDENTIALS environment variable set at the');
    console.log('system/user level (outside this project\'s .env). That alone is enough to make the SDK');
    console.log('silently switch into Vertex AI / OAuth mode instead of using your API key. Check Windows');
    console.log('"Environment Variables" (search for it in the Start menu) for any of the names flagged');
    console.log('above under both "User variables" and "System variables", remove them, then open a NEW');
    console.log('terminal (env var changes do not apply to already-open terminals) and try again.');
  } else {
    console.log('No local environment variables are forcing OAuth/Vertex mode - so if Step 3 failed with');
    console.log('the OAuth error, it is very likely the AQ.-format key rollout issue described in the chat,');
    console.log('not something wrong in this project\'s code.');
  }
  console.log('\nDone.');
})();
