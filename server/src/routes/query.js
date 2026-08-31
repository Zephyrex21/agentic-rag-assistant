const express = require('express');
const { randomUUID } = require('crypto');

const rag = require('../services/rag');
const { enforceGuestQueryLimit } = require('../middleware/guestQueryLimit');

const router = express.Router();

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /api/query - stateless, single-turn Q&A (no conversation memory).
// Streams via SSE. For multi-turn conversations, use
// POST /api/conversations/:id/messages instead.
router.post('/', enforceGuestQueryLimit, async (req, res) => {
  const { question, documentIds } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return errorResponse(res, 400, 'MISSING_QUESTION', 'Request body must include a non-empty "question" string.');
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Without this, Node can buffer small/infrequent writes (Nagle's algorithm)
  // instead of flushing them immediately - the exact bug that made SSE
  // events silently sit in a buffer until the client timed out, even though
  // the server had already written and ended the response on its end.
  req.socket.setNoDelay(true);
  res.flushHeaders?.();

  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
  });

  try {
    const queryId = randomUUID();

    for await (const event of rag.retrieveAndAnswerStream(question, { documentIds, isCancelled: () => clientDisconnected, userId: req.user?.id ?? null })) {
      if (clientDisconnected) break;

      if (event.type === 'sources') {
        writeSseEvent(res, 'sources', { sources: event.sources });
      } else if (event.type === 'chunk') {
        writeSseEvent(res, 'chunk', { text: event.text });
      } else if (event.type === 'no_info') {
        writeSseEvent(res, 'chunk', { text: event.answer });
        writeSseEvent(res, 'done', {
          answer: event.answer,
          sources: [],
          verified: true,
          wasRevised: false,
          trace: event.trace ?? null,
          queryId,
          guestQueriesRemaining: req.guestQueriesRemaining ?? null,
        });
      } else if (event.type === 'done') {
        // The first answer is final right now - send it immediately rather
        // than waiting on the background verification steps below, which
        // may still be in flight on this same connection.
        writeSseEvent(res, 'done', {
          answer: event.answer,
          sources: event.sources,
          verified: event.verified,
          wasRevised: false,
          trace: event.trace ?? null,
          queryId,
          guestQueriesRemaining: req.guestQueriesRemaining ?? null,
        });
      } else if (event.type === 'verified') {
        // Background verification passed - nothing about the visible
        // answer changes, just the verified flag/trace.
        writeSseEvent(res, 'verified', { verified: event.verified, trace: event.trace ?? null });
      } else if (event.type === 'revision_available') {
        // Background verification found a problem and generated a
        // corrected answer - offered as a suggestion, never applied
        // automatically. No conversation to persist it against here
        // (this is the stateless endpoint), so the client holds it
        // in-memory only.
        writeSseEvent(res, 'revision_available', {
          suggestedAnswer: event.suggestedAnswer,
          suggestedSources: event.suggestedSources,
          suggestedVerified: event.suggestedVerified,
          issue: event.issue,
          trace: event.trace ?? null,
        });
      }
    }

    if (!clientDisconnected) res.end();
  } catch (err) {
    console.error('[query] stream failed:', err.message);
    if (!clientDisconnected) {
      writeSseEvent(res, 'error', { message: err.message });
      res.end();
    }
  }
});

module.exports = router;
