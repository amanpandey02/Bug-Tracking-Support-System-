// routes/ai.js — AI engine endpoints
'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { aiService } = require('../services/aiService');

// GET /api/ai/status
router.get('/status', authenticate, (req, res) => {
  return res.json({ success: true, data: aiService.status() });
});

// POST /api/ai/triage/:bugId
router.post('/triage/:bugId', authenticate, async (req, res) => {
  try {
    const result = await aiService.triage(req.params.bugId, req.user.id);
    return res.json({ success: true, data: result, message: 'AI triage complete.' });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/ai/fix/:bugId
router.post('/fix/:bugId', authenticate, async (req, res) => {
  try {
    const result = await aiService.applyFix(req.params.bugId, req.user.id);
    return res.json({ success: true, data: result, message: 'AI fix initiated.' });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
});

// POST /api/ai/scan
router.post('/scan', authenticate, async (req, res) => {
  try {
    const result = await aiService.scan();
    return res.json({ success: true, data: result, message: `Scan complete. ${result.patternsFound} patterns found.` });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/ai/query
router.post('/query', authenticate, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ success: false, error: 'Query text required.' });
  try {
    const result = await aiService.query(query, req.user.id);
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
