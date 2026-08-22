/**
 * Standalone test for parseIntEnv/parseFloatEnv - no API key needed.
 * Run with: npm run test:envconfig
 */
const assert = require('assert');
const { parseIntEnv, parseFloatEnv } = require('./envConfig');

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

console.log('=== Env Config Validation Test ===\n');

// --- parseIntEnv ---

withEnv('TEST_INT', undefined, () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42), 42);
});
console.log('✅ parseIntEnv: unset env var falls back to the default (unchanged from plain parseInt behavior)');

withEnv('TEST_INT', '', () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42), 42);
});
console.log('✅ parseIntEnv: empty-string env var falls back to the default');

withEnv('TEST_INT', '17', () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42), 17);
});
console.log('✅ parseIntEnv: a valid integer is parsed and used');

withEnv('TEST_INT', 'not-a-number', () => {
  // This is the actual regression case: plain `parseInt('not-a-number', 10)`
  // silently returns NaN and the `|| 'default'` guard does NOT catch it,
  // since the env var IS set (just to garbage) - NaN would propagate
  // silently into whatever used it. parseIntEnv must fall back instead.
  assert.strictEqual(parseIntEnv('TEST_INT', 42), 42, 'FAIL: a garbage value must fall back to the default, not become NaN');
});
console.log('✅ parseIntEnv: an invalid value (would silently be NaN with plain parseInt) falls back to the default instead');

withEnv('TEST_INT', '5', () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42, { min: 10 }), 42, 'FAIL: below-minimum should fall back to default');
});
console.log('✅ parseIntEnv: a value below the configured minimum falls back to the default');

withEnv('TEST_INT', '500', () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42, { max: 100 }), 42, 'FAIL: above-maximum should fall back to default');
});
console.log('✅ parseIntEnv: a value above the configured maximum falls back to the default');

withEnv('TEST_INT', '50', () => {
  assert.strictEqual(parseIntEnv('TEST_INT', 42, { min: 10, max: 100 }), 50);
});
console.log('✅ parseIntEnv: a value within an explicit min/max range is accepted');

// --- parseFloatEnv ---

withEnv('TEST_FLOAT', undefined, () => {
  assert.strictEqual(parseFloatEnv('TEST_FLOAT', 0.35), 0.35);
});
console.log('✅ parseFloatEnv: unset env var falls back to the default');

withEnv('TEST_FLOAT', '0.5', () => {
  assert.strictEqual(parseFloatEnv('TEST_FLOAT', 0.35), 0.5);
});
console.log('✅ parseFloatEnv: a valid float is parsed and used');

withEnv('TEST_FLOAT', 'garbage', () => {
  assert.strictEqual(parseFloatEnv('TEST_FLOAT', 0.35), 0.35, 'FAIL: garbage should fall back to default, not NaN');
});
console.log('✅ parseFloatEnv: an invalid value falls back to the default instead of becoming NaN');

withEnv('TEST_FLOAT', '1.5', () => {
  assert.strictEqual(parseFloatEnv('TEST_FLOAT', 0.35, { min: 0, max: 1 }), 0.35, 'FAIL: above-max should fall back to default');
});
console.log('✅ parseFloatEnv: a value above a configured maximum (e.g. a probability > 1) falls back to the default');

console.log('\n✅ All env config validation tests passed.');
