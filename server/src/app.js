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

// Uploads still land on local disk temporarily during processing (deleted after
// ingestion completes). Document/conversation metadata now lives in Supabase
// (Phase 3) instead of the local data/documents.json used in Phase 1/2.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

// ALLOWED_ORIGIN is optional - unset (the default) allows all origins,
// which is fine for local dev and for a same-origin production deploy
// (frontend/backend behind one domain). Set it explicitly if the frontend
// is deployed to a separate domain and you want to lock CORS down to just
// that origin instead of "*". No auth layer exists in this app (see
// README's Known Limitations), so this is a defense-in-depth knob, not a
// substitute for real access control.
app.use(cors(process.env.ALLOWED_ORIGIN ? { origin: process.env.ALLOWED_ORIGIN } : undefined));
app.use(express.json());

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
  };
  const modelWarnings = Object.entries(configuredModels)
    .filter(([, model]) => KNOWN_PROBLEMATIC_MODELS.includes(model))
    .map(([envVar, model]) => `${envVar}=${model} has been decommissioned by Groq - consider updating`);

  res.json({
    status: 'ok',
    phase: 'Phase 7 - Streaming + Premium UI (Groq + Jina)',
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    jinaConfigured: Boolean(process.env.JINA_API_KEY),
    pineconeConfigured: Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_NAME),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    pipeline: {
      queryRewrite: process.env.ENABLE_QUERY_REWRITE !== 'false',
      queryExpansion: process.env.ENABLE_QUERY_EXPANSION !== 'false',
      hybridSearch: process.env.ENABLE_HYBRID_SEARCH !== 'false',
      reranking: process.env.ENABLE_RERANKING !== 'false',
      deduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
      adaptiveTopK: process.env.ENABLE_ADAPTIVE_TOPK !== 'false',
      selfVerification: process.env.ENABLE_SELF_VERIFICATION !== 'false',
    },
    ...(modelWarnings.length > 0 ? { modelWarnings } : {}),
  });
});

app.use('/api/documents', documentsRouter);
app.use('/api/query', queryRouter);
app.use('/api/conversations', conversationsRouter);
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
