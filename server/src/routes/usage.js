const express = require('express');
const usageTracker = require('../services/usageTracker');

const router = express.Router();

// GET /api/usage - lightweight visibility into how much of the free-tier
// Groq/Jina quota this server process has used since it started. See
// usageTracker.js for what this does and doesn't track (in particular:
// resets on restart, this is not a billing system).
router.get('/', (req, res) => {
  res.json(usageTracker.getUsageSummary());
});

module.exports = router;
