/**
 * Standalone test for runBackgroundVerification's client-disconnect
 * cancellation - no API key needed, verifyAnswer/generateAnswer are
 * injected fakes (see rag.js's runBackgroundVerification deps params).
 *
 * Regression coverage for the fix: background verification used to run to
 * completion (up to BACKGROUND_VERIFICATION_TIMEOUT_MS, several Groq calls
 * deep) even after a client had already disconnected, because the route's
 * clientDisconnected flag was only ever checked before WRITING a result,
 * never before starting the work that produced it.
 *
 * Run with: npm run test:cancellation
 */
const assert = require('assert');
const { runBackgroundVerification } = require('../services/rag');

async function main() {
  console.log('=== Background Verification Cancellation Test ===\n');

  const baseArgs = {
    question: 'What is the refund policy?',
    fullAnswer: 'The refund policy allows returns within 30 days [1].',
    finalSources: [{ sourceNumber: 1, filename: 'policy.pdf' }],
    workingChunks: [{ id: 'c1', text: 'Refunds within 30 days.' }],
    listsUsed: ['vector'],
    traceRaw: {},
    documentIds: null,
    history: [],
    streamStart: Date.now(),
  };

  // --- Case 1: verification fails, but the client is already gone by the
  // time we'd start generating a revision - revision generation must be
  // skipped entirely (the actual bug: this used to run anyway). ---
  {
    let generateAnswerCalls = 0;
    const result = await runBackgroundVerification({
      ...baseArgs,
      traceRaw: {},
      isCancelled: () => true,
      verifyAnswerFn: async () => ({ passed: false, issue: 'Missing citation for a claim.' }),
      generateAnswerFn: async () => {
        generateAnswerCalls += 1;
        return 'should never be produced';
      },
    });
    assert.strictEqual(result, null, 'FAIL: a cancelled background check should return null, not a revision event');
    assert.strictEqual(generateAnswerCalls, 0, 'FAIL: revision generation must not run once the client has disconnected');
    console.log('✅ Verification fails + client already disconnected -> revision generation is skipped entirely');
  }

  // --- Case 2: verification fails, client is still connected - the normal
  // path must be completely unaffected by the isCancelled plumbing. ---
  {
    let generateAnswerCalls = 0;
    const result = await runBackgroundVerification({
      ...baseArgs,
      traceRaw: {},
      isCancelled: () => false,
      verifyAnswerFn: async (_q, answer) =>
        answer.includes('should never be produced')
          ? { passed: true, issue: null } // the second (post-revision) check
          : { passed: false, issue: 'Missing citation for a claim.' },
      generateAnswerFn: async () => {
        generateAnswerCalls += 1;
        return 'A corrected answer with a proper citation [1].';
      },
    });
    assert.strictEqual(generateAnswerCalls, 1, 'FAIL: revision generation SHOULD run when the client is still connected');
    assert.strictEqual(result.type, 'revision_available', 'FAIL: expected a revision_available event');
    assert.strictEqual(result.suggestedAnswer, 'A corrected answer with a proper citation [1].');
    console.log('✅ Verification fails + client still connected -> revision is generated and returned normally');
  }

  // --- Case 3: verification passes outright - isCancelled should never
  // even be consulted, since there is no revision work to consider skipping. ---
  {
    let isCancelledCalls = 0;
    const result = await runBackgroundVerification({
      ...baseArgs,
      traceRaw: {},
      isCancelled: () => {
        isCancelledCalls += 1;
        return false;
      },
      verifyAnswerFn: async () => ({ passed: true, issue: null }),
      generateAnswerFn: async () => {
        throw new Error('FAIL: generateAnswer should never be called when verification passes');
      },
    });
    assert.strictEqual(result.type, 'verified');
    assert.strictEqual(result.verified, true);
    console.log(`✅ Verification passes outright -> returns a 'verified' event, no revision path touched (isCancelled checked ${isCancelledCalls}x)`);
  }

  // --- Case 4: isCancelled defaults to "never cancelled" when omitted -
  // every existing caller that doesn't pass it (or a test calling this
  // directly) must see identical behavior to before this existed. ---
  {
    const result = await runBackgroundVerification({
      ...baseArgs,
      traceRaw: {},
      // isCancelled deliberately omitted
      verifyAnswerFn: async () => ({ passed: true, issue: null }),
      generateAnswerFn: async () => {
        throw new Error('FAIL: should not be reached');
      },
    });
    assert.strictEqual(result.type, 'verified', 'FAIL: omitting isCancelled must default to "never cancelled", not throw or skip');
    console.log('✅ Omitting isCancelled entirely defaults to "never cancelled" - fully backward compatible');
  }

  console.log('\n✅ All background verification cancellation tests passed.');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
