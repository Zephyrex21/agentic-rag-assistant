require('dotenv').config();
const app = require('./app');
const { checkForProblematicModels } = require('./services/modelFallback');
const { sweepOrphanedUploads } = require('./services/uploadCleanup');

const PORT = process.env.PORT || 5000;

checkForProblematicModels({
  GENERATION_MODEL: process.env.GENERATION_MODEL,
  GENERATION_MODEL_FALLBACK: process.env.GENERATION_MODEL_FALLBACK,
  UTILITY_MODEL: process.env.UTILITY_MODEL,
  UTILITY_MODEL_FALLBACK: process.env.UTILITY_MODEL_FALLBACK,
});

// Best-effort cleanup of temp upload files left behind by a crashed
// process (one that never reached processDocument's `finally` block - see
// uploadCleanup.js). Run once at startup, then periodically for a
// long-running process so files from a crash later in the process's life
// don't just sit there until the next restart.
sweepOrphanedUploads();
setInterval(sweepOrphanedUploads, 6 * 60 * 60 * 1000).unref(); // every 6h - unref() so this alone never keeps the process alive

app.listen(PORT, () => {
  console.log(`\n🚀 RAG Assistant server running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(
    `   Groq: ${process.env.GROQ_API_KEY ? 'configured' : 'MISSING - set GROQ_API_KEY in .env'} | ` +
      `Jina: ${process.env.JINA_API_KEY ? 'configured' : 'MISSING - set JINA_API_KEY in .env'}\n`
  );
});
