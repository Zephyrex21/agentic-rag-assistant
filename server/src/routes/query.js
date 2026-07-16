const express = require('express');
const { randomUUID } = require('crypto');

const { retrieveAndAnswerStream } = require('../services/rag');

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
router.post('/', async (req, res) => {
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
    let finalAnswer = '';
    let finalSources = [];

    for await (const event of retrieveAndAnswerStream(question, { documentIds })) {
      if (clientDisconnected) break;

      if (event.type === 'sources') {
        writeSseEvent(res, 'sources', { sources: event.sources });
      } else if (event.type === 'chunk') {
        writeSseEvent(res, 'chunk', { text: event.text });
      } else if (event.type === 'no_info') {
        finalAnswer = event.answer;
        writeSseEvent(res, 'chunk', { text: event.answer });
      } else if (event.type === 'done') {
        finalAnswer = event.answer;
        finalSources = event.sources;
      }
    }

    if (clientDisconnected) return;

    writeSseEvent(res, 'done', { answer: finalAnswer, sources: finalSources, queryId: randomUUID() });
    res.end();
  } catch (err) {
    console.error('[query] stream failed:', err.message);
    if (!clientDisconnected) {
      writeSseEvent(res, 'error', { message: err.message });
      res.end();
    }
  }
});

module.exports = router;
