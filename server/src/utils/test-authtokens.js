/**
 * Standalone test for authTokens.js - no network/DB needed.
 * Run with: npm run test:authtokens
 */
const assert = require('assert');
const { signToken, verifyToken } = require('../services/authTokens');

console.log('=== Auth Tokens Test ===\n');

const token = signToken('user-123');
assert.strictEqual(typeof token, 'string');
assert.ok(token.length > 0);
console.log('✅ signToken produces a non-empty string');

assert.strictEqual(verifyToken(token), 'user-123');
console.log('✅ verifyToken recovers the original userId from a valid token');

assert.strictEqual(verifyToken(undefined), null, 'FAIL: a missing token should verify to null, not throw');
assert.strictEqual(verifyToken(''), null, 'FAIL: an empty token should verify to null');
console.log('✅ A missing/empty token verifies to null rather than throwing');

assert.strictEqual(verifyToken('not-a-real-jwt'), null, 'FAIL: a malformed token should verify to null');
console.log('✅ A malformed token verifies to null rather than throwing');

assert.strictEqual(verifyToken(token + 'tampered'), null, 'FAIL: a tampered signature should fail verification');
console.log('✅ A tampered token (altered signature) fails verification');

// A token signed with a DIFFERENT secret should never verify against this
// process's secret - simulates what happens if JWT_SECRET changes between
// deploys (every existing session cookie should stop working, not be
// silently accepted).
const jwt = require('jsonwebtoken');
const foreignToken = jwt.sign({ sub: 'user-123' }, 'a-completely-different-secret', { expiresIn: '30d' });
assert.strictEqual(verifyToken(foreignToken), null, 'FAIL: a token signed with a different secret must not verify');
console.log('✅ A token signed with a different secret never verifies (session cookies are invalidated on a secret change)');

console.log('\n✅ All auth token tests passed.');
