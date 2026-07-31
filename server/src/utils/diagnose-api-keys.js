require('dotenv').config();
const Groq = require('groq-sdk');

/**
 * Standalone diagnostic for the Groq (generation) + Jina (embeddings) setup.
 * Bypasses the whole app (Express, ingestion pipeline, etc.) and talks to
 * both APIs directly, so a pass/fail here tells you definitively whether a
 * problem is local config (missing/wrong key) or something on the
 * provider's side - without digging through server logs first.
 *
 * Run with: npm run diagnose:keys
 */

function mask(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return key[0] + '***';
  return `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} chars)`;
}

async function testGroq() {
  console.log('\n--- Groq (generation/reranking/rewriting/verification) ---');
  const apiKey = process.env.GROQ_API_KEY;
  console.log(`  GROQ_API_KEY = ${mask(apiKey)}`);
  if (!apiKey) {
    console.log('  Skipped - no key set. Get one free (no card required) at https://console.groq.com/keys');
    return;
  }
  try {
    const client = new Groq({ apiKey });
    const model = process.env.UTILITY_MODEL || 'llama-3.1-8b-instant';
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
      max_completion_tokens: 10,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    console.log(`  \u2705 SUCCESS - "${model}" responded: "${text}"`);
  } catch (err) {
    console.log('  \u274c FAILED');
    console.log(`     message: ${err.message}`);
    if (err.status !== undefined) console.log(`     status:  ${err.status}`);
    if (err.error) console.log(`     body:    ${JSON.stringify(err.error)}`);
  }
}

async function testJina() {
  console.log('\n--- Jina (embeddings) ---');
  const apiKey = process.env.JINA_API_KEY;
  console.log(`  JINA_API_KEY = ${mask(apiKey)}`);
  if (!apiKey) {
    console.log('  Skipped - no key set. Get one free at https://jina.ai/embeddings/');
    return;
  }
  const model = process.env.EMBEDDING_MODEL || 'jina-embeddings-v3';
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '768', 10);
  try {
    const response = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: ['diagnostic test string'], task: 'retrieval.passage', dimensions, normalized: true }),
    });
    if (!response.ok) {
      const raw = await response.text();
      console.log(`  \u274c FAILED (HTTP ${response.status})`);
      console.log(`     ${raw.slice(0, 400)}`);
      return;
    }
    const data = await response.json();
    const dims = data.data?.[0]?.embedding?.length ?? 0;
    console.log(`  \u2705 SUCCESS - "${model}" returned a ${dims}-dimension vector.`);
    if (dims !== dimensions) {
      console.log(`     \u26a0\ufe0f  Expected ${dimensions} dims (matching your Pinecone index) but got ${dims} - check EMBEDDING_DIMENSIONS.`);
    }
  } catch (err) {
    console.log('  \u274c FAILED');
    console.log(`     ${err.message}`);
  }
}

async function testCerebras() {
  console.log('\n--- Cerebras (optional provider fallback) ---');
  const apiKey = process.env.CEREBRAS_API_KEY;
  console.log(`  CEREBRAS_API_KEY = ${mask(apiKey)}`);
  if (!apiKey) {
    console.log('  Not set - this is optional. Skipped (the app works fine without it; Groq alone is the primary path).');
    return;
  }
  try {
    const Cerebras = require('@cerebras/cerebras_cloud_sdk');
    const client = new Cerebras({ apiKey });
    const model = process.env.CEREBRAS_FALLBACK_MODEL || 'llama-3.3-70b';
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
      max_tokens: 10,
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    console.log(`  \u2705 SUCCESS - "${model}" responded: "${text}"`);
  } catch (err) {
    console.log('  \u274c FAILED');
    console.log(`     message: ${err.message}`);
    if (err.status !== undefined) console.log(`     status:  ${err.status}`);
  }
}

(async () => {
  console.log('=== Groq + Jina + Cerebras API Diagnostic ===');
  await testGroq();
  await testJina();
  await testCerebras();
  console.log('\nDone.');
})();
