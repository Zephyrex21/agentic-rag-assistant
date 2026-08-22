const { parseIntEnv } = require('../utils/envConfig');
const usageTracker = require('./usageTracker');

const JINA_URL = 'https://api.jina.ai/v1/embeddings';
const MODEL = process.env.EMBEDDING_MODEL || 'jina-embeddings-v3';
const DIMENSIONS = parseIntEnv('EMBEDDING_DIMENSIONS', 768, { min: 1 });

// --- Concurrency limiting -------------------------------------------------
// Jina's free tier allows only this many SIMULTANEOUS in-flight requests
// (2, per their docs) - a hard ceiling independent of the separate
// requests-per-minute limit. This pipeline can easily exceed 2 concurrent
// embedding calls for a single user question now: multi-query retrieval
// embeds 2-3 phrasings in parallel (queryExpansion.js), and agentic mode
// can run several search_documents tool calls in parallel on top of that
// (agenticRag.js). Without limiting concurrency HERE, at the one place
// every embedding call funnels through, those legitimate parallel searches
// collide with Jina's own ceiling and 429 - "Concurrency limit exceeded."
// This queues anything past the limit instead of firing it all at once,
// trading a little latency for actually working. Global to the process,
// not per-request, since the whole point is coordinating across
// concurrent callers.
const MAX_CONCURRENCY = parseIntEnv('JINA_MAX_CONCURRENCY', 2, { min: 1 });
let activeRequests = 0;
const waitQueue = [];

function acquireSlot() {
  if (activeRequests < MAX_CONCURRENCY) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releaseSlot() {
  const next = waitQueue.shift();
  if (next) {
    next(); // hand the freed slot straight to the next waiter - activeRequests unchanged
  } else {
    activeRequests--;
  }
}

// --- Retry on 429 ----------------------------------------------------------
// A 429 here specifically means "too many concurrent/rate-limited requests
// right now", not "your request is malformed" - Jina's own error message
// says as much ("wait for pending requests to complete before sending new
// ones"). A short backoff and retry will very likely succeed once a slot
// frees up, so it's worth a few attempts before surfacing an error - unlike
// any OTHER error status, where retrying wouldn't fix anything and should
// fail immediately instead of wasting time.
const MAX_RETRIES = parseIntEnv('JINA_MAX_RETRIES', 3, { min: 0 });
const RETRY_BASE_DELAY_MS = parseIntEnv('JINA_RETRY_BASE_DELAY_MS', 500, { min: 0 });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 768 is one of jina-embeddings-v3's officially supported Matryoshka
 * checkpoint sizes (32/64/128/256/512/768/1024), chosen deliberately to
 * match the existing Pinecone index dimensionality - no index recreation
 * needed when migrating from Gemini's embeddings. (Vectors from a
 * different model are never comparable to old ones regardless of
 * dimension though - re-ingest your documents after switching providers.)
 *
 * Defensive re-normalization even though we request `normalized: true` -
 * cheap insurance in case a response isn't perfectly unit-length, and
 * cosine similarity in Pinecone depends on it.
 */
function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

function getApiKey() {
  const apiKey = process.env.JINA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No API key available for Jina embeddings. Set JINA_API_KEY in server/.env. ' +
        'Get a free key (no credit card required) at https://jina.ai/embeddings/'
    );
  }
  return apiKey;
}

function extractJinaErrorMessage(status, rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    const msg = parsed?.detail || parsed?.error?.message || parsed?.message;
    if (msg) return `Jina embeddings API error (${status}): ${msg}`;
  } catch {
    // raw body wasn't JSON, fall through
  }
  return `Jina embeddings API error (${status}): ${rawBody.slice(0, 300)}`;
}

async function callJina(texts, task) {
  let response;
  try {
    response = await fetch(JINA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: texts,
        task,
        dimensions: DIMENSIONS,
        normalized: true,
      }),
    });
  } catch (err) {
    // Deliberately NO automatic fallback here, unlike generation/utility -
    // a different embedding model/dimension could silently corrupt (or
    // hard-fail) your Pinecone index. A clear, diagnosable error is safer
    // than a fallback that might succeed but poison your vector store.
    throw new Error(`Jina embeddings request failed: ${err.message}`);
  }

  if (response.ok) {
    const data = await response.json();
    // Response is OpenAI-embeddings-shaped: { data: [{ embedding, index }, ...] }.
    // Items should already be input-order, but sort by `index` defensively.
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    usageTracker.recordJinaCall(texts.length);
    return sorted.map((item) => l2Normalize(item.embedding));
  }

  const raw = await response.text();
  const error = new Error(extractJinaErrorMessage(response.status, raw));
  error.status = response.status;
  throw error;
}

/**
 * Embeds a batch of texts.
 * @param {string[]} texts
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType - RETRIEVAL_DOCUMENT for
 *   chunks being stored, RETRIEVAL_QUERY for a user's question at query time.
 *   Kept as the same enum-style values the rest of the codebase already
 *   uses (from the Gemini version) so ingestionWorker.js and rag.js don't
 *   need to change - translated internally to Jina's retrieval.passage /
 *   retrieval.query task adapters, which serve the same purpose.
 */
async function embedBatch(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  if (!texts.length) return [];
  const task = taskType === 'RETRIEVAL_QUERY' ? 'retrieval.query' : 'retrieval.passage';

  await acquireSlot();
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await callJina(texts, task);
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        if (err.status !== 429 || isLastAttempt) throw err;
        // eslint-disable-next-line no-await-in-loop
        await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt); // 500ms, 1s, 2s
      }
    }
    // Unreachable - the loop always either returns or throws - but keeps
    // the function's return type honest for anything statically analyzing it.
    return [];
  } finally {
    releaseSlot();
  }
}

async function embedOne(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const [vector] = await embedBatch([text], taskType);
  return vector;
}

module.exports = { embedBatch, embedOne, MODEL, DIMENSIONS, l2Normalize, extractJinaErrorMessage, MAX_CONCURRENCY };
