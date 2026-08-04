require('dotenv').config();
const app = require('./app');
const { checkForProblematicModels } = require('./services/modelFallback');

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
