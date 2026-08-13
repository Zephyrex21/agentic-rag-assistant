/**
 * Standalone test for embeddings.js - no real API key/network call needed.
 * global.fetch is mocked per-scenario to test the concurrency limiter and
 * 429-retry logic deterministically, the same "swap the network boundary
 * for a controllable fake" approach the route tests use with
 * t.mock.method for the DB/provider layers.
 * Run with: npm run test:embeddings
 */
process.env.JINA_API_KEY = 'test-key-not-real';
process.env.JINA_RETRY_BASE_DELAY_MS = '5'; // keep retry-path tests fast

console.log('=== Embeddings Test ===\n');

function freshEmbeddings() {
  delete require.cache[require.resolve('../services/embeddings')];
  return require('../services/embeddings');
}

// --- l2Normalize ---
{
  const { l2Normalize } = freshEmbeddings();
  const normalized = l2Normalize([3, 4]); // 3-4-5 triangle, norm = 5
  console.assert(Math.abs(normalized[0] - 0.6) < 1e-9 && Math.abs(normalized[1] - 0.8) < 1e-9, 'FAIL: l2Normalize should produce a unit vector');
  const mag = Math.sqrt(normalized.reduce((s, v) => s + v * v, 0));
  console.assert(Math.abs(mag - 1) < 1e-9, `FAIL: normalized vector magnitude should be 1, got ${mag}`);
  console.log('✅ l2Normalize produces a correct unit vector');

  console.assert(JSON.stringify(l2Normalize([0, 0, 0])) === JSON.stringify([0, 0, 0]), 'FAIL: zero vector should pass through unchanged, not divide by zero');
  console.log('✅ l2Normalize handles the zero-vector edge case without dividing by zero');
}

// --- extractJinaErrorMessage ---
{
  const { extractJinaErrorMessage } = freshEmbeddings();
  const withDetail = extractJinaErrorMessage(429, JSON.stringify({ detail: 'Concurrency limit exceeded: 2/2 concurrent requests.' }));
  console.assert(withDetail.includes('Concurrency limit exceeded'), 'FAIL: should surface the "detail" field from a JSON error body');
  console.log('✅ Extracts the "detail" field from a JSON error response');

  const withErrorMessage = extractJinaErrorMessage(401, JSON.stringify({ error: { message: 'Invalid API key' } }));
  console.assert(withErrorMessage.includes('Invalid API key'), 'FAIL: should surface a nested error.message field');
  console.log('✅ Extracts a nested error.message field from a JSON error response');

  const nonJson = extractJinaErrorMessage(500, 'Internal Server Error (not JSON)');
  console.assert(nonJson.includes('Internal Server Error'), 'FAIL: should fall back to the raw body when it is not JSON');
  console.log('✅ Falls back to the raw response body when it is not valid JSON, without throwing');
}

// --- Concurrency limiter ---
async function testConcurrencyLimiter() {
  process.env.JINA_MAX_CONCURRENCY = '2';
  const { embedOne, MAX_CONCURRENCY } = freshEmbeddings();
  console.assert(MAX_CONCURRENCY === 2, `FAIL: expected MAX_CONCURRENCY=2 from env, got ${MAX_CONCURRENCY}`);

  let inFlight = 0;
  let maxObserved = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    inFlight++;
    maxObserved = Math.max(maxObserved, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 20)); // hold the "slot" long enough for overlaps to be observable
    inFlight--;
    return { ok: true, json: async () => ({ data: [{ embedding: [1, 0, 0], index: 0 }] }) };
  };

  try {
    // Fire 5 embedding calls at once - the limiter should never let more
    // than JINA_MAX_CONCURRENCY of them actually be in-flight simultaneously,
    // even though all 5 are "requested" at the same instant.
    await Promise.all([1, 2, 3, 4, 5].map(() => embedOne('some query text', 'RETRIEVAL_QUERY')));
  } finally {
    global.fetch = originalFetch;
  }

  console.assert(maxObserved <= 2, `FAIL: expected at most 2 concurrent Jina calls, observed ${maxObserved}`);
  console.log(`✅ Concurrency limiter caps simultaneous Jina calls at JINA_MAX_CONCURRENCY (observed max: ${maxObserved})`);
}

// --- Retry on 429, no retry on other errors ---
async function testRetryBehavior() {
  process.env.JINA_MAX_CONCURRENCY = '2';
  process.env.JINA_MAX_RETRIES = '3';
  const { embedOne } = freshEmbeddings();
  const originalFetch = global.fetch;

  // Case: fails with 429 twice, then succeeds - should transparently retry
  // and return the successful result, not surface an error.
  let attempts = 0;
  global.fetch = async () => {
    attempts++;
    if (attempts <= 2) {
      return { ok: false, status: 429, text: async () => JSON.stringify({ detail: 'Concurrency limit exceeded: 2/2 concurrent requests.' }) };
    }
    return { ok: true, json: async () => ({ data: [{ embedding: [0, 1, 0], index: 0 }] }) };
  };

  try {
    const vector = await embedOne('some query text', 'RETRIEVAL_QUERY');
    console.assert(attempts === 3, `FAIL: expected exactly 3 attempts (2 failures + 1 success), got ${attempts}`);
    console.assert(Array.isArray(vector) && vector.length === 3, 'FAIL: should return the successful embedding after retries');
    console.log('✅ Retries transparently on 429 and succeeds once the underlying call stops failing');
  } finally {
    global.fetch = originalFetch;
  }

  // Case: a non-429 error (e.g. bad request) should NOT be retried - fail
  // immediately, since retrying wouldn't fix a malformed request.
  let nonRetryAttempts = 0;
  global.fetch = async () => {
    nonRetryAttempts++;
    return { ok: false, status: 400, text: async () => JSON.stringify({ detail: 'Bad request' }) };
  };

  try {
    let threw = false;
    try {
      await embedOne('some query text', 'RETRIEVAL_QUERY');
    } catch {
      threw = true;
    }
    console.assert(threw, 'FAIL: a non-429 error should propagate as a thrown error');
    console.assert(nonRetryAttempts === 1, `FAIL: a non-429 error should not be retried, expected 1 attempt, got ${nonRetryAttempts}`);
    console.log('✅ A non-429 error fails immediately without wasting retries');
  } finally {
    global.fetch = originalFetch;
  }

  // Case: 429 on every attempt should exhaust retries and surface the error
  // rather than retry forever.
  let exhaustedAttempts = 0;
  global.fetch = async () => {
    exhaustedAttempts++;
    return { ok: false, status: 429, text: async () => JSON.stringify({ detail: 'still rate limited' }) };
  };

  try {
    let threw = false;
    try {
      await embedOne('some query text', 'RETRIEVAL_QUERY');
    } catch {
      threw = true;
    }
    console.assert(threw, 'FAIL: exhausting all retries on persistent 429s should still surface an error');
    console.assert(exhaustedAttempts === 4, `FAIL: expected 1 initial attempt + 3 retries = 4 total, got ${exhaustedAttempts}`);
    console.log('✅ Persistent 429s exhaust retries (bounded, not infinite) and surface an error');
  } finally {
    global.fetch = originalFetch;
  }
}

(async () => {
  await testConcurrencyLimiter();
  await testRetryBehavior();
  console.log('\n✅ All embeddings tests passed.');
})();
