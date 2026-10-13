const test = require('node:test');
const assert = require('node:assert');
const { describeError, classifyError, KIND, DEFAULT_MESSAGES } = require('../src/utils/userFacingError');

const FALLBACK = { code: 'LIST_FAILED', message: "Couldn't load your documents. Please try again." };

// Real messages seen in the wild (screenshots / Render logs / provider docs).
const GROQ_429 =
  'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01abc123def` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7200, Requested 2100. Please try again in 6.75s.';
const GROQ_TOO_LARGE =
  'Request too large for model `openai/gpt-oss-120b` in organization `org_01abc123def` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 9500, please reduce your message size and try again.';

test('classifyError - the exact errors from the screenshots are "service unavailable"', () => {
  assert.strictEqual(classifyError(new Error('documentStore.list failed: TypeError: fetch failed')), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(new Error('conversationStore.listConversations failed: TypeError: fetch failed')), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(new Error('documentStore.create failed: TypeError: fetch failed')), KIND.UNAVAILABLE);
});

test('classifyError - other connectivity signatures (message, err.code and err.cause.code)', () => {
  assert.strictEqual(classifyError(new Error('Connection error.')), KIND.UNAVAILABLE); // groq-sdk / openai SDK
  assert.strictEqual(classifyError(new Error('getaddrinfo ENOTFOUND abc.supabase.co')), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(new Error('invalid json response body at https://x.supabase.co reason: Unexpected token <')), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(new Error('<!DOCTYPE html><html><body>Service paused</body></html>')), KIND.UNAVAILABLE);
});

test('classifyError - provider HTTP statuses', () => {
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { status: 503 })), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { status: 502 })), KIND.UNAVAILABLE);
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { status: 429 })), KIND.AI_BUSY);
  assert.strictEqual(classifyError(Object.assign(new Error('x'), { status: 413 })), KIND.TOO_LARGE);
});

test('classifyError - a Groq "request too large" message is TOO_LARGE, not AI_BUSY (it also mentions tokens per minute)', () => {
  assert.strictEqual(classifyError(new Error(GROQ_TOO_LARGE)), KIND.TOO_LARGE);
  assert.strictEqual(classifyError(new Error(GROQ_429)), KIND.AI_BUSY);
});

test('classifyError - timeouts', () => {
  assert.strictEqual(classifyError(new Error('Request timed out.')), KIND.TIMEOUT);
  assert.strictEqual(classifyError(Object.assign(new Error('aborted'), { name: 'AbortError' })), KIND.TIMEOUT);
});

test('classifyError - ordinary failures stay UNKNOWN (no over-eager matching)', () => {
  // The existing folders test relies on exactly this one staying a plain 500.
  assert.strictEqual(classifyError(new Error('db unreachable')), KIND.UNKNOWN);
  assert.strictEqual(classifyError(new Error('boom')), KIND.UNKNOWN);
  assert.strictEqual(classifyError(new Error('duplicate key value violates unique constraint')), KIND.UNKNOWN);
  assert.strictEqual(classifyError(new Error('column content_hash does not exist')), KIND.UNKNOWN);
  assert.strictEqual(classifyError(null), KIND.UNKNOWN);
  assert.strictEqual(classifyError(undefined), KIND.UNKNOWN);
});

test('describeError - recognised failures get a friendly message, status and code (caller fallback ignored)', () => {
  const unavailable = describeError(new Error('documentStore.list failed: TypeError: fetch failed'), FALLBACK);
  assert.deepStrictEqual(
    { status: unavailable.status, code: unavailable.code, message: unavailable.message },
    { status: 503, code: 'SERVICE_UNAVAILABLE', message: DEFAULT_MESSAGES.UNAVAILABLE }
  );

  const busy = describeError(new Error(GROQ_429), FALLBACK);
  assert.strictEqual(busy.status, 429);
  assert.strictEqual(busy.code, 'AI_BUSY');

  const large = describeError(new Error(GROQ_TOO_LARGE), FALLBACK);
  assert.strictEqual(large.status, 413);
  assert.strictEqual(large.code, 'REQUEST_TOO_LARGE');

  const slow = describeError(new Error('Request timed out.'), FALLBACK);
  assert.strictEqual(slow.status, 504);
  assert.strictEqual(slow.code, 'REQUEST_TIMEOUT');
});

test('describeError - friendly messages never leak provider/infra details', () => {
  const leaky = [
    'documentStore.list failed: TypeError: fetch failed',
    GROQ_429,
    GROQ_TOO_LARGE,
    'getaddrinfo ENOTFOUND abcdefghij.supabase.co',
    'Request timed out.',
    'Connection error.',
  ];
  for (const raw of leaky) {
    const { message } = describeError(new Error(raw), FALLBACK);
    assert.doesNotMatch(message, /TypeError|fetch failed|supabase|org_|openai\/|gpt-oss|tokens per minute|getaddrinfo|ENOTFOUND|Store\b|\.list|\.create/i, `leaked from: ${raw}`);
  }
});

test('describeError - an UNRECOGNISED failure keeps the caller\'s own code, status and safe message, and never echoes err.message', () => {
  const out = describeError(new Error('documentStore.list failed: relation "documents" does not exist'), FALLBACK);
  assert.deepStrictEqual(out, { kind: KIND.UNKNOWN, status: 500, code: 'LIST_FAILED', message: FALLBACK.message });
  assert.doesNotMatch(out.message, /relation|documents" does not/);
});

test('describeError - sensible defaults when the caller gives no fallback', () => {
  const out = describeError(new Error('weird'));
  assert.deepStrictEqual(out, { kind: KIND.UNKNOWN, status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
});

test('describeError - allowExposed keeps a framework-approved message (e.g. a malformed-JSON 400) but only when explicitly allowed', () => {
  const bodyParserLike = Object.assign(new Error('Unexpected token } in JSON at position 5'), { status: 400, expose: true });
  const withFlag = describeError(bodyParserLike, { allowExposed: true });
  assert.strictEqual(withFlag.status, 400);
  assert.match(withFlag.message, /Unexpected token/);

  const withoutFlag = describeError(bodyParserLike);
  assert.strictEqual(withoutFlag.status, 500);
  assert.strictEqual(withoutFlag.message, 'Something went wrong. Please try again.');

  // An error that is NOT marked expose:true never leaks, even with the flag.
  const plain = describeError(new Error('secret internal detail'), { allowExposed: true });
  assert.doesNotMatch(plain.message, /secret/);
});
