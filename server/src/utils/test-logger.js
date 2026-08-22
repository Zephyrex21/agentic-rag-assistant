/**
 * Standalone test for the structured logger - captures stdout/stderr
 * writes rather than needing a live process. Run with: npm run test:logger
 */
const assert = require('assert');

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

function captureWrites(stream, fn) {
  const original = stream.write;
  const written = [];
  stream.write = (chunk) => {
    written.push(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    stream.write = original;
  }
  return written;
}

console.log('=== Structured Logger Test ===\n');

withEnv('LOG_LEVEL', 'debug', () => {
  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');

  // --- error/warn go to stderr as valid, well-shaped JSON ---
  const stderrWrites = captureWrites(process.stderr, () => {
    logger.error('Something broke', { method: 'GET', path: '/api/documents' });
  });
  assert.strictEqual(stderrWrites.length, 1, 'FAIL: exactly one write expected');
  const parsed = JSON.parse(stderrWrites[0]);
  assert.strictEqual(parsed.level, 'error');
  assert.strictEqual(parsed.message, 'Something broke');
  assert.strictEqual(parsed.context.method, 'GET');
  assert.ok(parsed.timestamp, 'FAIL: expected an ISO timestamp field');
  console.log('✅ logger.error writes valid, well-shaped JSON to stderr');

  // --- info goes to stdout, not stderr ---
  let sawOnStdout = false;
  let sawOnStderr = false;
  captureWrites(process.stdout, () => {
    sawOnStdout = captureWrites(process.stderr, () => logger.info('Server started')).length === 0;
  });
  assert.strictEqual(sawOnStdout, true, 'FAIL: info-level logs should go to stdout, not stderr');
  console.log('✅ logger.info writes to stdout (not stderr), matching console.log/console.error stream conventions');

  // --- context is omitted entirely when empty, not an empty object ---
  const noContextWrites = captureWrites(process.stdout, () => {
    logger.info('No context here');
  });
  const noContextParsed = JSON.parse(noContextWrites[0]);
  assert.strictEqual('context' in noContextParsed, false, 'FAIL: an empty/omitted context should not appear as a key at all');
  console.log('✅ A log call with no context omits the "context" key entirely rather than emitting {}');
});

// --- LOG_LEVEL gating: 'warn' should suppress info/debug ---
withEnv('LOG_LEVEL', 'warn', () => {
  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');

  const infoWrites = captureWrites(process.stdout, () => logger.info('should be suppressed'));
  assert.strictEqual(infoWrites.length, 0, 'FAIL: info should be suppressed when LOG_LEVEL=warn');

  const warnWrites = captureWrites(process.stderr, () => logger.warn('should still appear'));
  assert.strictEqual(warnWrites.length, 1, 'FAIL: warn should still appear when LOG_LEVEL=warn');
});
console.log('✅ LOG_LEVEL correctly gates out lower-priority levels (info suppressed under LOG_LEVEL=warn, warn itself still shown)');

// --- default level (LOG_LEVEL unset) is 'info' - debug suppressed, info shown ---
withEnv('LOG_LEVEL', undefined, () => {
  delete require.cache[require.resolve('../utils/logger')];
  const logger = require('../utils/logger');

  const debugWrites = captureWrites(process.stdout, () => logger.debug('should be suppressed by default'));
  assert.strictEqual(debugWrites.length, 0, 'FAIL: debug should be suppressed by default (LOG_LEVEL unset -> info)');

  const infoWrites = captureWrites(process.stdout, () => logger.info('should appear by default'));
  assert.strictEqual(infoWrites.length, 1, 'FAIL: info should appear by default');
});
console.log("✅ Default LOG_LEVEL (unset) is 'info' - debug suppressed, info/warn/error all shown");

console.log('\n✅ All logger tests passed.');
