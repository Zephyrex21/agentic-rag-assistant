/**
 * Shared helpers for parsing numeric env vars with validation.
 *
 * The gap this closes: every numeric env var across this codebase used to
 * be read as `parseInt(process.env.X || 'default', 10)` directly at each
 * call site. That works fine as long as X is either unset or a valid
 * number - but if someone sets X to something invalid (a typo, a stray
 * quote, a value copied from the wrong place), `parseInt` silently returns
 * NaN, `|| 'default'` does NOT catch this (it only applies when the env
 * var is unset/empty, not when it's garbage), and that NaN then propagates
 * silently into whatever logic uses it - e.g. `Array.slice(0, NaN)`
 * returns an empty array, `setTimeout(fn, NaN)` fires immediately, a
 * NaN threshold comparison is always false. The failure is real but far
 * from where the actual mistake was made, and gives no indication of what
 * went wrong.
 *
 * These helpers fix that by validating at the read site: an invalid value
 * falls back to the same default a missing one would, but ALSO logs a
 * clear warning naming the variable and the bad value, so the mistake is
 * visible at boot instead of manifesting as unexplained behavior later.
 * This is fail-SAFE, not fail-HARD - matching this project's fail-soft
 * philosophy everywhere else (a misconfigured optional tuning value should
 * degrade to a sane default, not crash the whole server).
 */

function parseIntEnv(varName, defaultValue, options = {}) {
  const raw = process.env[varName];
  if (raw === undefined || raw === '') return defaultValue;

  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    console.warn(`[env] ${varName}="${raw}" is not a valid integer - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  if (options.min !== undefined && parsed < options.min) {
    console.warn(`[env] ${varName}=${parsed} is below the minimum (${options.min}) - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  if (options.max !== undefined && parsed > options.max) {
    console.warn(`[env] ${varName}=${parsed} is above the maximum (${options.max}) - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  return parsed;
}

function parseFloatEnv(varName, defaultValue, options = {}) {
  const raw = process.env[varName];
  if (raw === undefined || raw === '') return defaultValue;

  const parsed = parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`[env] ${varName}="${raw}" is not a valid number - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  if (options.min !== undefined && parsed < options.min) {
    console.warn(`[env] ${varName}=${parsed} is below the minimum (${options.min}) - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  if (options.max !== undefined && parsed > options.max) {
    console.warn(`[env] ${varName}=${parsed} is above the maximum (${options.max}) - falling back to the default (${defaultValue}).`);
    return defaultValue;
  }
  return parsed;
}

module.exports = { parseIntEnv, parseFloatEnv };
