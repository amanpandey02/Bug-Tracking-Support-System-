// routes/integrations.js — Integration configuration & management
'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  configureIntegration, disconnectIntegration, getAllIntegrations,
  github, jira, slack, pagerduty, datadog, sentry,
} = require('../services/integrationService');
const { getDb } = require('../config/database');

// ── GET /api/integrations ────────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  return res.json({ success: true, data: getAllIntegrations() });
});

// ── GET /api/integrations/:name ───────────────────────────────────────────────
router.get('/:name', authenticate, (req, res) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, name, is_enabled, status, last_sync, error_message, updated_at FROM integrations WHERE name = ?'
  ).get(req.params.name.toLowerCase());
  if (!row) return res.status(404).json({ success: false, error: 'Integration not found.' });

  // Return safe config (strip tokens)
  const rawConfig = db.prepare('SELECT config FROM integrations WHERE name = ?').get(req.params.name.toLowerCase());
  let config = {};
  try { config = JSON.parse(rawConfig.config); } catch {}

  // Mask sensitive fields
  const safe = { ...config };
  ['accessToken','apiToken','apiKey','appKey','botToken','signingSecret','authToken','webhookSecret'].forEach(k => {
    if (safe[k]) safe[k] = '••••••••' + safe[k].slice(-4);
  });

  return res.json({ success: true, data: { ...row, config: safe } });
});

// ── POST /api/integrations/:name/configure ─────────────────────────────────────
router.post('/:name/configure', authenticate, requireRole('Admin', 'Team Lead'), async (req, res) => {
  const name = req.params.name.toLowerCase();
  try {
    const result = await configureIntegration(name, req.body);
    return res.json({ success: true, data: result, message: `${name} integration configured successfully.` });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/integrations/:name ────────────────────────────────────────────
router.delete('/:name', authenticate, requireRole('Admin'), async (req, res) => {
  try {
    await disconnectIntegration(req.params.name.toLowerCase());
    return res.json({ success: true, message: `${req.params.name} disconnected.` });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/integrations/slack/test ──────────────────────────────────────────
router.post('/slack/test', authenticate, async (req, res) => {
  try {
    await slack.test();
    return res.json({ success: true, message: 'Test message sent to Slack.' });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/integrations/github/webhook ──────────────────────────────────────
// GitHub sends webhook events here
router.post('/github/webhook', express_raw(), async (req, res) => {
  const sig = req.headers['x-hub-signature-256'];
  const db = getDb();
  const cfg = JSON.parse(db.prepare("SELECT config FROM integrations WHERE name='github'").get()?.config || '{}');
  const secret = cfg.webhookSecret;

  if (secret) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig || ''), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
  }

  const event = req.headers['x-github-event'];
  const payload = JSON.parse(req.body.toString());
  try {
    const result = await github.handleWebhook(event, payload);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Raw body parser for webhook signature verification
function express_raw() {
  return require('express').raw({ type: 'application/json' });
}

// ── POST /api/integrations/jira/sync ──────────────────────────────────────────
router.post('/jira/sync', authenticate, async (req, res) => {
  const db = getDb();
  const openBugs = db.prepare(
    "SELECT * FROM bugs WHERE status NOT IN ('resolved','closed') AND external_refs NOT LIKE '%\"jira\"%' LIMIT 10"
  ).all();

  const results = [];
  for (const bug of openBugs) {
    try {
      const result = await jira.createIssue(bug);
      const refs = JSON.parse(bug.external_refs || '{}');
      refs.jira = result.jiraKey;
      db.prepare('UPDATE bugs SET external_refs = ? WHERE id = ?').run(JSON.stringify(refs), bug.id);
      results.push({ bugId: bug.bug_id, jiraKey: result.jiraKey });
    } catch (e) {
      results.push({ bugId: bug.bug_id, error: e.message });
    }
  }

  return res.json({ success: true, synced: results.length, data: results });
});

// ── GET /api/integrations/sentry/issues ───────────────────────────────────────
router.get('/sentry/issues', authenticate, async (req, res) => {
  try {
    const issues = await sentry.getIssues(parseInt(req.query.limit) || 10);
    return res.json({ success: true, data: issues });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
