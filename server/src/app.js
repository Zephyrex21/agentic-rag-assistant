require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const documentsRouter = require('./routes/documents');
const queryRouter = require('./routes/query');
const conversationsRouter = require('./routes/conversations');
const foldersRouter = require('./routes/folders');
const { KNOWN_PROBLEMATIC_MODELS } = require('./services/modelFallback');
const { requireAppAccessKey } = require('./middleware/auth');
const { generalLimiter, expensiveLimiter } = require('./middleware/rateLimit');

// Uploads still land on local disk temporarily during processing (deleted after
// ingestion completes). Document/conversation metadata now lives in Supabase
// (Phase 3) instead of the local data/documents.json used in Phase 1/2.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

// ALLOWED_ORIGIN is optional - unset (the default) allows all origins,
// which is fine for local dev and for a same-origin production deploy
// (frontend/backend behind one domain). Set it explicitly (comma-separated
// for more than one) if the frontend is deployed to a separate domain and
// you want to lock CORS down to just those origins instead of "*". This is
// defense-in-depth, layered on top of the APP_ACCESS_KEY auth below (see
// middleware/auth.js) - CORS alone was never real access control even when
// this was the only knob available, since it only affects browser
// requests, not direct API calls.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : undefined));
if (allowedOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  console.warn(
    '[app] ALLOWED_ORIGIN is not set in a production environment - accepting cross-origin requests from any site. ' +
      'Set ALLOWED_ORIGIN (comma-separated for multiple origins) to your deployed frontend URL(s).'
  );
}
app.use(express.json());

// Rate limiting - applied to every /api/* route (see middleware/rateLimit.js
// for why /health is deliberately excluded: it's a cheap, no-side-effect
// status check hosting platforms and uptime monitors poll frequently, and
// limiting it buys no real protection). The expensive limiter is layered
// on top of the general one for the specific routes that spend real
// Groq/Jina/Pinecone quota per request.
app.use('/api', generalLimiter);

// APP_ACCESS_KEY is optional - unset (the default) skips this entirely,
// same opt-in pattern as ALLOWED_ORIGIN above and every pipeline toggle in
// this codebase. Set it before any public deployment; see
// middleware/auth.js for the full rationale. Deliberately applied to
// /api/* only, after express.json() but before the routers - /health stays
// open so uptime checks and hosting platforms can poll it without a key.
app.use('/api', requireAppAccessKey);

// Defense in depth: if any route handler ever has an unwrapped async call that
// throws (like the upload bug this caught during testing), log it loudly instead
// of silently crashing the whole server and taking down every other request.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] This should have been caught in a route handler:', reason);
});

app.get('/health', (req, res) => {
  const configuredModels = {
    GENERATION_MODEL: process.env.GENERATION_MODEL || 'llama-3.3-70b-versatile',
    GENERATION_MODEL_FALLBACK: process.env.GENERATION_MODEL_FALLBACK || 'openai/gpt-oss-120b',
    UTILITY_MODEL: process.env.UTILITY_MODEL || 'llama-3.1-8b-instant',
    UTILITY_MODEL_FALLBACK: process.env.UTILITY_MODEL_FALLBACK || 'openai/gpt-oss-20b',
    AGENTIC_PLANNER_MODEL: process.env.AGENTIC_PLANNER_MODEL || process.env.UTILITY_MODEL || 'llama-3.1-8b-instant',
    AGENTIC_PLANNER_MODEL_FALLBACK:
      process.env.AGENTIC_PLANNER_MODEL_FALLBACK || process.env.UTILITY_MODEL_FALLBACK || 'openai/gpt-oss-20b',
  };
  const modelWarnings = Object.entries(configuredModels)
    .filter(([, model]) => KNOWN_PROBLEMATIC_MODELS.includes(model))
    .map(([envVar, model]) => `${envVar}=${model} has been decommissioned by Groq - consider updating`);

  res.json({
    status: 'ok',
    phase: 'Phase 8 - Agentic Retrieval (Groq tool calling)',
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    jinaConfigured: Boolean(process.env.JINA_API_KEY),
    pineconeConfigured: Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_NAME),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    pipeline: {
      agenticMode: process.env.ENABLE_AGENTIC_MODE !== 'false',
      agenticResearchOnRevision: process.env.ENABLE_AGENTIC_RESEARCH_ON_REVISION !== 'false',
      queryRewrite: process.env.ENABLE_QUERY_REWRITE !== 'false',
      queryExpansion: process.env.ENABLE_QUERY_EXPANSION !== 'false',
      hybridSearch: process.env.ENABLE_HYBRID_SEARCH !== 'false',
      reranking: process.env.ENABLE_RERANKING !== 'false',
      deduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
      adaptiveTopK: process.env.ENABLE_ADAPTIVE_TOPK !== 'false',
      selfVerification: process.env.ENABLE_SELF_VERIFICATION !== 'false',
      formatHints: process.env.ENABLE_FORMAT_HINTS !== 'false',
      pipelineTrace: process.env.ENABLE_PIPELINE_TRACE !== 'false',
    },
    ...(modelWarnings.length > 0 ? { modelWarnings } : {}),
  });
});

// The expensive limiter sits in front of entire documents/query/conversations
// routers rather than cherry-picking individual endpoints inside each one -
// every route in documents.js touches upload/ingestion-adjacent work, and
// every route in query.js/conversations.js can trigger a full LLM pipeline
// run, so router-level is both simpler and doesn't risk missing a new route
// added later. folders.js is plain CRUD against Supabase only, no LLM/embedding
// calls, so it stays under the general limiter alone.
app.use('/api/documents', expensiveLimiter, documentsRouter);
app.use('/api/query', expensiveLimiter, queryRouter);
app.use('/api/conversations', expensiveLimiter, conversationsRouter);
app.use('/api/folders', foldersRouter);

// Centralized fallback error handler
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Something went wrong.' } });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route: ${req.method} ${req.path}` } });
});

// Deliberately just builds and exports the app - no app.listen() here.
// That lives in server.js instead, so route tests (server/test/) can
// require this file and mount it in supertest without accidentally
// starting a real server on a real port every time a test file loads.
module.exports = app;
