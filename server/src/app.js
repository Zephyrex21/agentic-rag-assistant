require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const documentsRouter = require('./routes/documents');
const queryRouter = require('./routes/query');
const conversationsRouter = require('./routes/conversations');
const { checkForProblematicModels, KNOWN_PROBLEMATIC_MODELS } = require('./services/modelFallback');

// Uploads still land on local disk temporarily during processing (deleted after
// ingestion completes). Document/conversation metadata now lives in Supabase
// (Phase 3) instead of the local data/documents.json used in Phase 1/2.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

app.use(cors());
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
      hybridSearch: process.env.ENABLE_HYBRID_SEARCH !== 'false',
      reranking: process.env.ENABLE_RERANKING !== 'false',
      selfVerification: process.env.ENABLE_SELF_VERIFICATION !== 'false',
    },
    ...(modelWarnings.length > 0 ? { modelWarnings } : {}),
  });
});

app.use('/api/documents', documentsRouter);
app.use('/api/query', queryRouter);
app.use('/api/conversations', conversationsRouter);

// Centralized fallback error handler
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message || 'Something went wrong.' } });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route: ${req.method} ${req.path}` } });
});

const PORT = process.env.PORT || 5000;

checkForProblematicModels({
  GENERATION_MODEL: process.env.GENERATION_MODEL,
  GENERATION_MODEL_FALLBACK: process.env.GENERATION_MODEL_FALLBACK,
  UTILITY_MODEL: process.env.UTILITY_MODEL,
  UTILITY_MODEL_FALLBACK: process.env.UTILITY_MODEL_FALLBACK,
});

app.listen(PORT, () => {
  console.log(`\n🚀 RAG Assistant server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(
    `   Groq: ${process.env.GROQ_API_KEY ? 'configured' : 'MISSING - set GROQ_API_KEY in .env'} | ` +
      `Jina: ${process.env.JINA_API_KEY ? 'configured' : 'MISSING - set JINA_API_KEY in .env'}\n`
  );
});

module.exports = app;
