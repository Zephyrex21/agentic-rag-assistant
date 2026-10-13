/**
 * Turns failures into sentences that are safe and useful to show on screen.
 *
 * The server already sends friendly messages (see
 * server/src/utils/userFacingError.js) - this file covers the two cases it
 * can't:
 *   1. The request never reached the server (browser-level "Failed to fetch"
 *      / "NetworkError" / Safari's "Load failed"): there is no server message
 *      at all, only a raw TypeError.
 *   2. A newer client talking to an older server during a staggered deploy
 *      (Vercel and Render deploy independently): the server might still send
 *      raw text like "documentStore.list failed: TypeError: fetch failed".
 *
 * Deliberately has NO import from api.ts (api.ts imports this file), so
 * ApiError is recognised by shape instead of by instanceof - no cycle.
 *
 * The "raw text" detector matches real error-signature text, never product
 * names: some server messages are intentional diagnostics that legitimately
 * mention Supabase or a migration, and those must keep passing through.
 */

export const UNREACHABLE_MESSAGE = "Couldn't reach the server. It may be waking up - please try again in a moment.";
const SERVICE_UNAVAILABLE_MESSAGE = 'The service is temporarily unreachable. It may be waking up - please try again in a moment.';
const AI_BUSY_MESSAGE = 'The AI is busy right now. Please wait a moment and try again.';

// Text that only ever appears in raw, internal error output.
const RAW_ERROR_RE =
  /TypeError|fetch failed|failed to fetch|networkerror|load failed|\b(document|conversation|folder)Store\b|ECONNREFUSED|ECONNRESET|ENOTFOUND|getaddrinfo|<!doctype|<html|\borg_[a-z0-9]+|tokens per minute/i;
// What a browser throws when the request never got a response.
const BROWSER_NETWORK_ERROR_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;
const CONNECTIVITY_RE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|getaddrinfo/i;

function isApiErrorLike(err: unknown): err is Error & { status: number; code: string } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === 'number' && typeof (err as { code?: unknown }).code === 'string';
}

/**
 * Cleans up a message that came FROM the server (an API error body or an SSE
 * `error` event). Ordinary messages pass through untouched; raw-looking ones
 * are replaced by something friendly.
 */
export function friendlyServerMessage(message: string, fallback: string, status?: number): string {
  if (!RAW_ERROR_RE.test(message)) return message;
  if (status === 502 || status === 503 || status === 504 || CONNECTIVITY_RE.test(message)) return SERVICE_UNAVAILABLE_MESSAGE;
  if (status === 429 || /tokens per minute/i.test(message)) return AI_BUSY_MESSAGE;
  return fallback;
}

/**
 * The message to show for a caught error.
 * @param fallback - a complete, friendly sentence for failures we can't classify
 */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (isApiErrorLike(err)) return friendlyServerMessage(err.message || fallback, fallback, err.status);
  if (err instanceof Error) {
    if (BROWSER_NETWORK_ERROR_RE.test(err.message)) return UNREACHABLE_MESSAGE;
    // An ordinary message keeps showing exactly as before; only text that
    // looks like raw internal output is replaced.
    return friendlyServerMessage(err.message || fallback, fallback);
  }
  return fallback;
}
