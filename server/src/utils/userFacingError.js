/**
 * Turns raw internal errors into messages that are safe and useful to show
 * a person in the browser.
 *
 * Why this exists: store-layer errors are wrapped as
 * "<store>.<action> failed: <raw message>" (e.g. "documentStore.list failed:
 * TypeError: fetch failed"), and LLM provider errors carry the provider's own
 * text (which can include organisation ids, token counts and model names).
 * Both used to be forwarded verbatim to the browser - useful in development,
 * but confusing in a public app and a small information leak. The full raw
 * error is still logged by every call site (nothing here swallows it); only
 * what the *browser* sees changes.
 *
 * Deliberately conservative about what counts as a known failure kind: each
 * pattern below matches a real failure signature, not a vague word. Anything
 * unrecognised falls through to the caller's own safe fallback message and
 * keeps the caller's own error code / HTTP status, so existing API contracts
 * for ordinary failures don't change.
 */

const KIND = {
  UNAVAILABLE: 'UNAVAILABLE', // a service we depend on can't be reached (DB asleep/paused, network, provider down)
  AI_BUSY: 'AI_BUSY', // rate limits / quota / provider overloaded
  TOO_LARGE: 'TOO_LARGE', // request exceeds a model's size limit
  TIMEOUT: 'TIMEOUT', // something took too long
  UNKNOWN: 'UNKNOWN',
};

const DEFAULT_MESSAGES = {
  [KIND.UNAVAILABLE]: 'The service is temporarily unreachable. It may be waking up - please try again in a moment.',
  [KIND.AI_BUSY]: 'The AI is busy right now. Please wait a moment and try again.',
  [KIND.TOO_LARGE]: 'That request was too large for the AI to handle. Try a shorter question or fewer documents.',
  [KIND.TIMEOUT]: 'That took too long and was cancelled. Please try again.',
};

const HTTP_STATUS = {
  [KIND.UNAVAILABLE]: 503,
  [KIND.AI_BUSY]: 429,
  [KIND.TOO_LARGE]: 413,
  [KIND.TIMEOUT]: 504,
};

const ERROR_CODE = {
  [KIND.UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
  [KIND.AI_BUSY]: 'AI_BUSY',
  [KIND.TOO_LARGE]: 'REQUEST_TOO_LARGE',
  [KIND.TIMEOUT]: 'REQUEST_TIMEOUT',
};

// Node/undici network-level error codes (found on err.code or err.cause.code).
const CONNECTIVITY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TOO_LARGE_RE =
  /request too large|request entity too large|context[ _]length|maximum context|too many tokens|reduce (the length|your message|the number of tokens)/i;
const AI_BUSY_RE =
  /rate[ _-]?limit|too many requests|tokens per (minute|day)|requests per (minute|day)|quota|overloaded|over capacity|capacity exceeded/i;
const UNAVAILABLE_RE =
  /fetch failed|failed to fetch|network ?error|connection error|socket hang up|getaddrinfo|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|invalid json response|<!doctype|<html/i;
const TIMEOUT_RE = /timed out|timeout/i;

function statusOf(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * Sorts an error into a kind. Order matters: "request too large" messages
 * from providers also mention "tokens per minute", so the size check must
 * come before the rate-limit check.
 */
function classifyError(err) {
  if (!err) return KIND.UNKNOWN;
  const message = String(err.message ?? err);
  const status = statusOf(err);
  const code = err.code ?? err.cause?.code ?? null;

  if (status === 413 || TOO_LARGE_RE.test(message)) return KIND.TOO_LARGE;
  if (status === 429 || AI_BUSY_RE.test(message)) return KIND.AI_BUSY;
  if (status === 502 || status === 503 || status === 504) return KIND.UNAVAILABLE;
  if ((code && CONNECTIVITY_CODES.has(code)) || UNAVAILABLE_RE.test(message)) return KIND.UNAVAILABLE;
  if (err.name === 'AbortError' || err.name === 'TimeoutError' || TIMEOUT_RE.test(message)) return KIND.TIMEOUT;
  return KIND.UNKNOWN;
}

/**
 * Builds what the browser should see for a failure.
 *
 * @param {unknown} err - the raw error (still logged by the caller)
 * @param {object} [fallback]
 * @param {string} [fallback.code] - error code for an UNRECOGNISED failure (keeps each route's existing code)
 * @param {string} [fallback.message] - safe message for an UNRECOGNISED failure
 * @param {number} [fallback.status=500] - HTTP status for an UNRECOGNISED failure
 * @param {boolean} [fallback.allowExposed=false] - when true, an error that the framework itself
 *   marked as safe to show (err.expose === true, e.g. body-parser's "malformed JSON" 400s) keeps its
 *   own message and status instead of the generic fallback
 * @returns {{kind: string, status: number, code: string, message: string}}
 */
function describeError(err, fallback = {}) {
  const kind = classifyError(err);
  if (kind !== KIND.UNKNOWN) {
    return { kind, status: HTTP_STATUS[kind], code: ERROR_CODE[kind], message: DEFAULT_MESSAGES[kind] };
  }

  const { code = 'INTERNAL_ERROR', message = 'Something went wrong. Please try again.', status = 500, allowExposed = false } = fallback;
  if (allowExposed && err && err.expose === true && typeof err.message === 'string' && err.message) {
    return { kind, status: statusOf(err) ?? status, code, message: err.message };
  }
  return { kind, status, code, message };
}

/**
 * Convenience for the route files, each of which has its own local
 * errorResponse(res, status, code, message): returns exactly those last three
 * arguments, so a call site is a one-line change that keeps its existing
 * console.error logging and its existing error code for ordinary failures:
 *
 *   errorResponse(res, ...routeError(err, 'LIST_FAILED', "Couldn't load your documents. Please try again."));
 */
function routeError(err, code, message) {
  const { status, code: finalCode, message: finalMessage } = describeError(err, { code, message });
  return [status, finalCode, finalMessage];
}

module.exports = { describeError, routeError, classifyError, KIND, DEFAULT_MESSAGES };
