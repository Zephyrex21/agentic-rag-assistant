import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendMessageStream } from '../lib/api';
import { UNREACHABLE_MESSAGE } from '../lib/errors';

const RAW_RE = /TypeError|fetch failed|Failed to fetch|org_|tokens per minute|documentStore/i;

function sseResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamed answer errors reach the user as friendly sentences', () => {
  it('the server cannot be reached at all -> friendly "couldn\'t reach the server"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onError });
    expect(onError).toHaveBeenCalledWith(UNREACHABLE_MESSAGE);
  });

  it('a JSON error before streaming starts shows the server\'s friendly message', async () => {
    const body = { error: { code: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unreachable. It may be waking up - please try again in a moment.' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onError });
    expect(onError).toHaveBeenCalledWith(body.error.message);
  });

  it('a raw message from an older server is cleaned up before it is shown', async () => {
    const body = { error: { code: 'MESSAGE_FAILED', message: 'conversationStore.getConversation failed: TypeError: fetch failed' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 500, headers: { 'Content-Type': 'application/json' } })));
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).not.toMatch(RAW_RE);
    expect(onError.mock.calls[0][0]).toMatch(/temporarily unreachable/i);
  });

  it('an in-stream "error" event with a friendly message is shown as-is', async () => {
    const message = 'The AI is busy right now. Please wait a moment and try again.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(`event: error\ndata: ${JSON.stringify({ message, code: 'AI_BUSY' })}\n\n`)));
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onError });
    expect(onError).toHaveBeenCalledWith(message);
  });

  it('an in-stream "error" event carrying raw provider text is cleaned up (mixed-version deploy)', async () => {
    const raw = 'Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01abc` on tokens per minute (TPM)';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(`event: error\ndata: ${JSON.stringify({ message: raw })}\n\n`)));
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).not.toMatch(RAW_RE);
    expect(onError.mock.calls[0][0]).toMatch(/busy/i);
  });

  it('streamed answers themselves are unaffected - chunks and done still arrive', async () => {
    const stream =
      `event: chunk\ndata: ${JSON.stringify({ text: 'Hello' })}\n\n` +
      `event: done\ndata: ${JSON.stringify({ answer: 'Hello', sources: [] })}\n\n`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(stream)));
    const onChunk = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    await sendMessageStream('c1', 'hello', undefined, { onChunk, onDone, onError });
    expect(onChunk).toHaveBeenCalledWith('Hello');
    expect(onDone).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
