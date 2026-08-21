const rateLimit = require('express-rate-limit');

// Skip rate limiting entirely under the test runner - the route test suite
// (server/test/*.test.js) fires dozens of requests per file against the
// same in-process app with no real IP diversity, and none of that traffic
// is the abuse pattern this middleware exists to catch. Every other env
// var toggle in this codebase already treats NODE_ENV=test as "don't add
// friction here" (see e.g. how the eval harness and diagnose scripts are
// kept separate from the CI-run test suite).
const RATE_LIMITING_ENABLED = process.env.NODE_ENV !== 'test';

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 minutes
// General ceiling across all /api routes - generous enough that normal
// interactive use (browsing documents, switching conversations, polling
// upload status) never comes close, but bounds an outright flood.
const GENERAL_MAX = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
// Tighter ceiling specifically for the routes that cost real money/quota -
// LLM generation (query/conversation messages, each of which can be
// several Groq calls deep in agentic mode) and document upload (embedding
// + Pinecone + Supabase writes). This is the ceiling actually protecting
// the free-tier Groq/Jina/Pinecone quotas from a single abusive client.
const EXPENSIVE_MAX = parseInt(process.env.RATE_LIMIT_EXPENSIVE_MAX || '60', 10);

function errorResponse(req, res) {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.',
    },
  });
}

const generalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: GENERAL_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !RATE_LIMITING_ENABLED,
  handler: errorResponse,
});

const expensiveLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: EXPENSIVE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !RATE_LIMITING_ENABLED,
  handler: errorResponse,
});

module.exports = { generalLimiter, expensiveLimiter, RATE_LIMITING_ENABLED };
