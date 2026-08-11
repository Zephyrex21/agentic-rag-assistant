const express = require('express');

const conversationStore = require('../db/conversationStore');
const rag = require('../services/rag');

const router = express.Router();

const HISTORY_TURNS = parseInt(process.env.CONVERSATION_HISTORY_TURNS || '6', 10);

function errorResponse(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function titleFromQuestion(question) {
  const trimmed = question.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}...` : trimmed;
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /api/conversations - start a new conversation thread
router.post('/', async (req, res) => {
  try {
    const conversation = await conversationStore.createConversation();
    res.status(201).json({ conversationId: conversation.id, title: conversation.title });
  } catch (err) {
    console.error('[conversations] create failed:', err.message);
    errorResponse(res, 500, 'CREATE_FAILED', err.message);
  }
});

// GET /api/conversations - list all threads (most recently active first)
router.get('/', async (req, res) => {
  try {
    const conversations = await conversationStore.listConversations();
    res.json({
      conversations: conversations.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
    });
  } catch (err) {
    console.error('[conversations] list failed:', err.message);
    errorResponse(res, 500, 'LIST_FAILED', err.message);
  }
});

// GET /api/conversations/:id - full thread with all messages
router.get('/:id', async (req, res) => {
  try {
    const conversation = await conversationStore.getConversation(req.params.id);
    if (!conversation) return errorResponse(res, 404, 'CONVERSATION_NOT_FOUND', 'No conversation with that ID.');
    res.json(conversation);
  } catch (err) {
    console.error('[conversations] get failed:', err.message);
    errorResponse(res, 500, 'GET_FAILED', err.message);
  }
});

// POST /api/conversations/:id/messages - ask a question within this thread.
// Streams the answer via Server-Sent Events. Validation errors (missing
// question, unknown conversation) still happen as plain JSON responses
// BEFORE we commit to streaming - only once we're actually generating does
// the response switch into SSE mode.
router.post('/:id/messages', async (req, res) => {
  const { question, documentIds } = req.body || {};
  const conversationId = req.params.id;

  if (!question || typeof question !== 'string' || !question.trim()) {
    return errorResponse(res, 400, 'MISSING_QUESTION', 'Request body must include a non-empty "question" string.');
  }

  let conversation;
  try {
    conversation = await conversationStore.getConversation(conversationId);
  } catch (err) {
    console.error('[conversations] lookup failed:', err.message);
    return errorResponse(res, 500, 'MESSAGE_FAILED', err.message);
  }
  if (!conversation) return errorResponse(res, 404, 'CONVERSATION_NOT_FOUND', 'No conversation with that ID.');

  // From here on, the response is SSE - errors get sent as an `error` event
  // instead of an HTTP error status, since headers are already committed.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Without this, Node can buffer small/infrequent writes (Nagle's algorithm)
  // instead of flushing them immediately - see query.js for the full story.
  req.socket.setNoDelay(true);
  res.flushHeaders?.();

  let clientDisconnected = false;
  res.on('close', () => {
    clientDisconnected = true;
  });

  try {
    const recentMessages = await conversationStore.getRecentMessages(conversationId, HISTORY_TURNS);
    const history = recentMessages.map((m) => ({ role: m.role, content: m.content }));

    await conversationStore.addMessage(conversationId, { role: 'user', content: question });

    let finalAnswer = '';
    let finalSources = [];
    let verified = true;
    let wasRevised = false;
    let trace = null;

    for await (const event of rag.retrieveAndAnswerStream(question, { documentIds, history })) {
      if (clientDisconnected) break; // stop doing work if nobody's listening anymore

      if (event.type === 'sources') {
        writeSseEvent(res, 'sources', { sources: event.sources });
      } else if (event.type === 'revising') {
        writeSseEvent(res, 'revising', { issue: event.issue });
      } else if (event.type === 'chunk') {
        writeSseEvent(res, 'chunk', { text: event.text });
      } else if (event.type === 'no_info') {
        finalAnswer = event.answer;
        trace = event.trace ?? null;
        writeSseEvent(res, 'chunk', { text: event.answer });
      } else if (event.type === 'done') {
        finalAnswer = event.answer;
        finalSources = event.sources;
        verified = event.verified ?? true;
        wasRevised = event.wasRevised ?? false;
        trace = event.trace ?? null;
      }
    }

    if (clientDisconnected) return;

    const assistantMessage = await conversationStore.addMessage(conversationId, {
      role: 'assistant',
      content: finalAnswer,
      sources: finalSources,
      verified,
      wasRevised,
      pipelineTrace: trace,
    });

    if (conversation.title === 'New conversation' && conversation.messages.length === 0) {
      await conversationStore.updateTitle(conversationId, titleFromQuestion(question));
    }

    writeSseEvent(res, 'done', {
      messageId: assistantMessage.id,
      answer: finalAnswer,
      sources: finalSources,
      verified,
      wasRevised,
      trace,
    });
    res.end();
  } catch (err) {
    console.error('[conversations] message stream failed:', err.message);
    if (!clientDisconnected) {
      writeSseEvent(res, 'error', { message: err.message });
      res.end();
    }
  }
});

// DELETE /api/conversations/:id
router.delete('/:id', async (req, res) => {
  try {
    const conversation = await conversationStore.getConversation(req.params.id);
    if (!conversation) return errorResponse(res, 404, 'CONVERSATION_NOT_FOUND', 'No conversation with that ID.');
    await conversationStore.deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[conversations] delete failed:', err.message);
    errorResponse(res, 500, 'DELETE_FAILED', err.message);
  }
});

module.exports = router;
