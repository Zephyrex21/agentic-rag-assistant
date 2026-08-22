/**
 * A minimal structured logger - JSON-line output instead of a bare
 * console.log/warn/error string, so log lines are actually machine-
 * parseable (grep-by-field, feed into a log aggregator, etc.) without
 * needing to reach for a heavier dependency like winston/pino.
 *
 * Deliberately NOT a wholesale replacement for every existing
 * console.log/warn/error call across the codebase - that would be a huge,
 * mostly-cosmetic diff touching dozens of files for comparatively little
 * benefit (every existing call already includes a `[module]` prefix and a
 * clear message by convention, which is most of what structured logging
 * buys you at this project's scale). This is the new standard going
 * forward for genuinely operational log lines (request-level errors,
 * startup diagnostics) - see app.js's error handler and server.js's
 * startup sequence for the first uses - existing call sites are untouched
 * and remain perfectly fine as they are.
 *
 * Output format: one JSON object per line -
 *   {"level":"error","message":"...","timestamp":"...","context":{...}}
 * - the standard shape most log aggregators (Datadog, CloudWatch, a
 * hosting platform's own log viewer) expect for structured ingestion.
 *
 * LOG_LEVEL controls the floor: 'error' < 'warn' < 'info' < 'debug'.
 * Defaults to 'info' - debug-level detail is opt-in.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[configured] !== undefined ? LEVELS[configured] : LEVELS.info;
}

function log(level, message, context) {
  if (LEVELS[level] > currentLevel()) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };

  const line = JSON.stringify(entry);
  // error/warn go to stderr, info/debug to stdout - matches how console.error/
  // console.warn vs console.log already split streams, so existing log
  // routing/filtering set up around that distinction keeps working.
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = {
  error: (message, context) => log('error', message, context),
  warn: (message, context) => log('warn', message, context),
  info: (message, context) => log('info', message, context),
  debug: (message, context) => log('debug', message, context),
};
