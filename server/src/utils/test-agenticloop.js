/**
 * Standalone test for the agentic planner's actual LOOP CONTROL logic - no
 * API key or network call needed. callPlannerTurn/executeToolCalls are
 * injected fakes (see agenticRag.js's runAgentPlanner/runAgenticRetrieval
 * deps params).
 *
 * This is genuinely new coverage, not a duplicate of test-agenticplanner.js
 * (which only covers the pure resolveSearchQuery/parseToolArgs helpers) or
 * the eval harness (which needs live Groq/Pinecone/Jina keys). What's
 * tested here - step budget enforcement, message threading between turns,
 * chunk accumulation/dedup by id across multiple tool calls, and the
 * first-turn-throws-vs-later-turn-throws error handling split - is the
 * actual multi-turn tool-calling loop's own control flow, previously only
 * exercised by manual testing and the eval harness against real APIs.
 *
 * Run with: npm run test:agenticloop
 */
const assert = require('assert');
const { runAgentPlanner, runAgenticRetrieval } = require('../services/agenticRag');

function fakeChunk(id, filename = 'doc.pdf') {
  return { id, filename, section: null, text: `text for ${id}`, relevanceScore: 0.9 };
}

// A fake assistant message requesting one search_documents tool call.
function toolCallMsg(id, query) {
  return {
    role: 'assistant',
    tool_calls: [{ id, function: { name: 'search_documents', arguments: JSON.stringify({ query }) } }],
  };
}

// A fake assistant message with no tool calls - the "I have enough, stop" signal.
function stopMsg(content = 'Done.') {
  return { role: 'assistant', content, tool_calls: [] };
}

async function main() {
  console.log('=== Agentic Planner Loop Test ===\n');

  // --- 1. First turn has no tool calls -> skippedSearch, zero chunks, one attempt only ---
  {
    let calls = 0;
    const result = await runAgentPlanner('hi there', [], null, 3, {
      callPlannerTurn: async () => {
        calls += 1;
        return stopMsg('Hello! Ask me about your documents anytime.');
      },
      executeToolCalls: async () => {
        throw new Error('FAIL: executeToolCalls should never run when the first turn requests no tools');
      },
    });
    assert.strictEqual(calls, 1, 'FAIL: should only call the planner once when it immediately stops');
    assert.strictEqual(result.skippedSearch, true);
    assert.deepStrictEqual(result.chunks, []);
    assert.deepStrictEqual(result.steps, []);
    console.log('✅ First turn skips tool calls -> skippedSearch=true, no chunks, no wasted turns');
  }

  // --- 2. Multi-step: turn 1 searches, turn 2 searches again, turn 3 stops ---
  // Verifies message threading (each turn sees the accumulated conversation)
  // and that chunks from BOTH searches are accumulated.
  {
    const turnQueries = [];
    const result = await runAgentPlanner('compare X and Y', [], null, 5, {
      callPlannerTurn: async (messages) => {
        turnQueries.push(messages.length);
        if (turnQueries.length === 1) return toolCallMsg('call-1', 'X specifics');
        if (turnQueries.length === 2) return toolCallMsg('call-2', 'Y specifics');
        return stopMsg('I have enough now.');
      },
      executeToolCalls: async (toolCalls, _documentIds, _fallbackQuery) => {
        const query = JSON.parse(toolCalls[0].function.arguments).query;
        const chunkId = query.startsWith('X') ? 'chunk-x' : 'chunk-y';
        return [
          {
            toolCallId: toolCalls[0].id,
            summary: `Found 1 relevant passage(s): doc.pdf`,
            chunks: [fakeChunk(chunkId)],
            step: { tool: 'search_documents', query, chunksFound: 1, rescueTriggered: false, durationMs: 5 },
          },
        ];
      },
    });

    assert.strictEqual(result.skippedSearch, false);
    assert.strictEqual(result.chunks.length, 2, 'FAIL: expected chunks accumulated from both searches');
    assert.deepStrictEqual(result.chunks.map((c) => c.id).sort(), ['chunk-x', 'chunk-y']);
    assert.strictEqual(result.steps.length, 2, 'FAIL: expected exactly 2 recorded steps (turn 3 made no tool call)');
    // Message list should have grown each turn: turn 2 sees turn 1's tool call
    // + tool result appended, turn 3 sees turn 2's as well - strictly increasing.
    assert.ok(turnQueries[1] > turnQueries[0], 'FAIL: turn 2 should see a longer message history than turn 1 (tool call + result threaded in)');
    assert.ok(turnQueries[2] > turnQueries[1], 'FAIL: turn 3 should see a longer message history than turn 2');
    console.log('✅ Multi-turn search (2 searches then stop) -> chunks from both accumulated, message history correctly threaded between turns');
  }

  // --- 3. Step budget is a hard ceiling: a planner that ALWAYS wants to
  // search more must still be cut off at exactly maxSteps turns. ---
  {
    let callCount = 0;
    const result = await runAgentPlanner('exhaustive question', [], null, 3, {
      callPlannerTurn: async () => {
        callCount += 1;
        return toolCallMsg(`call-${callCount}`, `query ${callCount}`);
      },
      executeToolCalls: async (toolCalls) => [
        {
          toolCallId: toolCalls[0].id,
          summary: 'Found 1 relevant passage(s): doc.pdf',
          chunks: [fakeChunk(`chunk-${callCount}`)],
          step: { tool: 'search_documents', query: `query ${callCount}`, chunksFound: 1, rescueTriggered: false, durationMs: 5 },
        },
      ],
    });
    assert.strictEqual(callCount, 3, `FAIL: planner should be called exactly maxSteps=3 times, was called ${callCount} times`);
    assert.strictEqual(result.steps.length, 3);
    assert.strictEqual(result.chunks.length, 3, 'FAIL: expected one chunk accumulated per forced turn');
    console.log('✅ A planner that always wants to keep searching is hard-capped at exactly maxSteps turns, not one more');
  }

  // --- 4. Deduplication by chunk id: the SAME chunk surfacing from two
  // different search calls must only be counted/kept once. ---
  {
    let turn = 0;
    const result = await runAgentPlanner('overlapping searches', [], null, 3, {
      callPlannerTurn: async () => {
        turn += 1;
        if (turn <= 2) return toolCallMsg(`call-${turn}`, `query ${turn}`);
        return stopMsg();
      },
      executeToolCalls: async (toolCalls) => [
        {
          toolCallId: toolCalls[0].id,
          summary: 'Found 2 relevant passage(s): doc.pdf',
          // Both searches happen to surface the same chunk ("shared") plus one unique one each.
          chunks: [fakeChunk('shared'), fakeChunk(`unique-${turn}`)],
          step: { tool: 'search_documents', query: `query ${turn}`, chunksFound: 2, rescueTriggered: false, durationMs: 5 },
        },
      ],
    });
    const ids = result.chunks.map((c) => c.id).sort();
    assert.deepStrictEqual(ids, ['shared', 'unique-1', 'unique-2'], `FAIL: expected the shared chunk deduped to one copy, got ${JSON.stringify(ids)}`);
    console.log('✅ A chunk found by more than one search call is only accumulated once (dedup by id)');
  }

  // --- 5. First-turn failure propagates (caller falls back to the fixed
  // pipeline entirely - see rag.js's retrieveAndAnswerStream) ---
  {
    await assert.rejects(
      () =>
        runAgentPlanner('will fail immediately', [], null, 3, {
          callPlannerTurn: async () => {
            throw new Error('simulated Groq outage');
          },
        }),
      /simulated Groq outage/,
      'FAIL: a first-turn failure should propagate, not be silently swallowed'
    );
    console.log('✅ A first-turn planner failure propagates to the caller (which falls back to the fixed pipeline)');
  }

  // --- 6. A LATER-turn failure (after at least one successful search) is
  // swallowed - whatever was already gathered is kept instead of losing it. ---
  {
    let turn = 0;
    const result = await runAgentPlanner('partial failure', [], null, 3, {
      callPlannerTurn: async () => {
        turn += 1;
        if (turn === 1) return toolCallMsg('call-1', 'first query');
        throw new Error('simulated transient failure on turn 2');
      },
      executeToolCalls: async (toolCalls) => [
        {
          toolCallId: toolCalls[0].id,
          summary: 'Found 1 relevant passage(s): doc.pdf',
          chunks: [fakeChunk('chunk-1')],
          step: { tool: 'search_documents', query: 'first query', chunksFound: 1, rescueTriggered: false, durationMs: 5 },
        },
      ],
    });
    assert.strictEqual(result.chunks.length, 1, 'FAIL: the first successful search result should be kept despite the second turn failing');
    assert.strictEqual(result.chunks[0].id, 'chunk-1');
    console.log('✅ A later-turn failure keeps whatever was already gathered instead of losing it, rather than propagating');
  }

  // --- 7. End-to-end through runAgenticRetrieval: chunks.length===0 AND
  // skippedSearch===false is the genuine "searched but found nothing" case
  // -> null chunks (distinct from the skipped-search empty-array case). ---
  {
    const result = await runAgenticRetrieval('a question nothing answers', null, [], {
      maxSteps: 2,
      callPlannerTurn: async () => toolCallMsg('call-1', 'a query'),
      executeToolCalls: async (toolCalls) => [
        {
          toolCallId: toolCalls[0].id,
          summary: 'No relevant passages found for this query.',
          chunks: [],
          step: { tool: 'search_documents', query: 'a query', chunksFound: 0, rescueTriggered: false, durationMs: 5 },
        },
      ],
    });
    assert.strictEqual(result.chunks, null, 'FAIL: searched but found nothing should be null, not an empty array (distinct meaning from skipped-search)');
    assert.strictEqual(result.traceRaw.noInfo, true);
    console.log('✅ runAgenticRetrieval: searched but found nothing -> chunks is null (the genuine "not enough information" case)');
  }

  // --- 8. End-to-end through runAgenticRetrieval: skipped search entirely
  // -> empty array (NOT null) - generation still runs with zero sources. ---
  {
    const result = await runAgenticRetrieval('hey, what can you do?', null, [], {
      maxSteps: 2,
      callPlannerTurn: async () => stopMsg(),
    });
    assert.deepStrictEqual(result.chunks, [], 'FAIL: skipped search should be an empty array, not null - distinct downstream handling in llm.js');
    assert.strictEqual(result.traceRaw.skippedSearch, true);
    console.log('✅ runAgenticRetrieval: skipped search entirely -> chunks is [] (not null) - the assistant still replies naturally, doesn\'t hard-fail');
  }

  console.log('\n✅ All agentic planner loop tests passed.');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
