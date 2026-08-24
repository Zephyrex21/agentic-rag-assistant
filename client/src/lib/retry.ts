/**
 * Retries an async operation once after a short delay - specifically for
 * the handful of "boot time" fetches (initial documents/folders/
 * conversations list) that can race a backend which hasn't finished
 * starting yet. This is most visible in local dev (`npm run dev` starts
 * the client's Vite server and the backend's nodemon process concurrently
 * - nodemon's file-watch setup can take a beat longer than Vite's, so the
 * page's very first API calls sometimes land before the backend socket is
 * listening) but is a reasonable safety net in production too (a brief
 * network blip, a cold-start edge case).
 *
 * Deliberately NOT used for every API call in the app - actions the
 * person actively triggers (sending a message, uploading a file) should
 * fail fast and visibly, not silently retry and leave them wondering why
 * nothing happened for an extra second and a half.
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 1, delayMs = 1200): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return withRetry(fn, retries - 1, delayMs);
  }
}
