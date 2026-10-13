import { describe, it, expect } from 'vitest';
import { friendlyErrorMessage, friendlyServerMessage, UNREACHABLE_MESSAGE } from '../lib/errors';
import { ApiError } from '../lib/api';

const FALLBACK = "Couldn't load your documents. Please try again.";

describe('friendlyErrorMessage - the request never reached the server', () => {
  it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'Network request failed'])(
    'turns the browser error "%s" into a friendly "couldn\'t reach the server" message',
    (message) => {
      expect(friendlyErrorMessage(new TypeError(message), FALLBACK)).toBe(UNREACHABLE_MESSAGE);
    }
  );

  it('never contains developer jargon', () => {
    expect(UNREACHABLE_MESSAGE).not.toMatch(/Is it running|TypeError|backend/i);
  });
});

describe('friendlyErrorMessage - messages that came from the server', () => {
  it('passes a normal server message through untouched', () => {
    const err = new ApiError('Only PDF, DOCX, TXT and MD files are supported.', 'UPLOAD_FAILED', 400);
    expect(friendlyErrorMessage(err, FALLBACK)).toBe('Only PDF, DOCX, TXT and MD files are supported.');
  });

  it('keeps intentional diagnostic messages that merely mention a product name or migration', () => {
    const msg = 'Sign-in codes are not set up yet: run migration_008 in the Supabase SQL editor.';
    expect(friendlyErrorMessage(new ApiError(msg, 'OTP_STORE_FAILED', 500), FALLBACK)).toBe(msg);
  });

  it('replaces raw store/network text from an OLDER server (mixed-version deploy) with a friendly sentence', () => {
    const raw = new ApiError('documentStore.list failed: TypeError: fetch failed', 'LIST_FAILED', 500);
    const out = friendlyErrorMessage(raw, FALLBACK);
    expect(out).toMatch(/temporarily unreachable/i);
    expect(out).not.toMatch(/TypeError|fetch failed|documentStore/);
  });

  it('replaces a raw provider rate-limit message (org id, token counts) with a friendly one', () => {
    const raw = new ApiError('Rate limit reached for model x in organization `org_01abc` on tokens per minute (TPM)', 'ANSWER_FAILED', 429);
    const out = friendlyErrorMessage(raw, FALLBACK);
    expect(out).toMatch(/busy/i);
    expect(out).not.toMatch(/org_|tokens per minute/);
  });

  it('uses the fallback for raw text it cannot classify', () => {
    const raw = new ApiError('conversationStore.getConversation failed: boom', 'GET_FAILED', 500);
    expect(friendlyErrorMessage(raw, FALLBACK)).toBe(FALLBACK);
  });

  it('keeps the client\'s own friendly timeout message', () => {
    const err = new ApiError('This is taking longer than expected. The server may still be waking up - please try again.', 'REQUEST_TIMEOUT', 0);
    expect(friendlyErrorMessage(err, FALLBACK)).toMatch(/taking longer than expected/);
  });
});

describe('friendlyErrorMessage - everything else', () => {
  it('keeps an ordinary plain Error message exactly as before (behaviour is unchanged for non-raw text)', () => {
    expect(friendlyErrorMessage(new Error('That code expired.'), FALLBACK)).toBe('That code expired.');
  });

  it('uses the fallback for non-Error throwables', () => {
    expect(friendlyErrorMessage('weird string', FALLBACK)).toBe(FALLBACK);
    expect(friendlyErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(friendlyErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  it('uses the fallback for an Error with an empty message', () => {
    expect(friendlyErrorMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
  });
});

describe('friendlyServerMessage (used for streamed answer errors)', () => {
  it('leaves a clean message alone', () => {
    expect(friendlyServerMessage('The AI is busy right now. Please wait a moment and try again.', 'x')).toBe(
      'The AI is busy right now. Please wait a moment and try again.'
    );
  });

  it('cleans up raw text', () => {
    expect(friendlyServerMessage('Connection error. TypeError: fetch failed', 'fallback')).toMatch(/temporarily unreachable/i);
    expect(friendlyServerMessage('Some org_abc123 thing', 'fallback')).toBe('fallback');
  });
});
