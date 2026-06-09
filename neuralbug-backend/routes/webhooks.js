// routes/webhooks.js — Inbound webhooks from integrations
'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');
const { broadcastEvent } = require('../services/wsService');

// Raw body needed for HMAC verification
const rawBody = require('express').raw({ type: '*/*' });

// ── Verify HMAC signatures ─────────────────────────────────────────────────────
function verifyHmac(secret, body, signature, algo = 'sha256', prefix = 'sha256=') {
  const expected = prefix + crypto.createHmac(algo, secret).update(body).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

// ── Shared bug upsert helper ─────────────────────────────────────────────────
function upsertBugFromExternal(source, externalId, title, severity, description) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM bugs WHERE external_refs LIKE ?`).get(`%"${source}":"${externalId}"%`);
  if (existing) return existing;

  const last = db.prepare("SELECT bug_id FROM bugs ORDER BY bug_id DESC LIMIT 1").get();
  const nextNum = last ? parseInt(last.bug_id.replace('BUG-','')) + 1 : 1;
  const bugId = `BUG-${String(nextNum).padStart(3,'0')}`;
  const id = uuid();

  db.prepare(`
    INSERT INTO bugs (id, bug_id, title, description, severity, status, project, source, external_refs)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, bugId, title, description, severity || 'medium', 'open',
    source.charAt(0).toUpperCase() + source.slice(1),
    source,
    JSON.stringify({ [source]: externalId }));

  broadcastEvent('bug:created', { bugId: id, source });
  return db.prepare('SELECT * FROM bugs WHERE id = ?').get(id);
}

// ══════════════════════════════════════════════════════
//  GITHUB WEBHOOK
// ══════════════════════════════════════════════════════
router.post('/github', rawBody, async (req, res) => {
  const db = getDb();
  const cfg = JSON.parse(db.prepare("SELECT config FROM integrations WHERE name='github'").get()?.config || '{}');
  const sig = req.headers['x-hub-signature-256'] || '';

  if (cfg.webhookSecret && !verifyHmac(cfg.webhookSecret, req.body, sig)) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  const event = req.headers['x-github-event'];
  const payload = JSON.parse(req.body.toString());

  if (event === 'issues') {
    const { action, issue, repository } = payload;
    const sevMap = { bug: 'high', security: 'critical', enhancement: 'low' };
    const labels = issue.labels?.map(l => l.name) || [];
    const severity = labels.find(l => sevMap[l]) ? sevMap[labels.find(l => sevMap[l])] : 'medium';

    if (action === 'opened') {
      upsertBugFromExternal('github', String(issue.number), issue.title, severity, issue.body);
    } else if (action === 'closed') {
      const bug = db.prepare("SELECT * FROM bugs WHERE external_refs LIKE ?").get(`%"github":"${issue.number}"%`);
      if (bug) {
        db.prepare("UPDATE bugs SET status='resolved', resolved_at=? WHERE id=?").run(new Date().toISOString(), bug.id);
        broadcastEvent('bug:resolved', { bugId: bug.id, source: 'github' });
      }
    }
  }

  if (event === 'push') {
    // Auto-close bugs referenced in commit messages: "Fixes BUG-007" or "Closes BUG-012"
    const commits = payload.commits || [];
    for (const commit of commits) {
      const matches = commit.message.match(/(?:fixes?|closes?|resolves?)\s+(BUG-\d+)/gi) || [];
      for (const m of matches) {
        const bugNum = m.split(/\s+/)[1];
        db.prepare("UPDATE bugs SET status='resolved', resolved_at=? WHERE bug_id=?").run(new Date().toISOString(), bugNum.toUpperCase());
        broadcastEvent('bug:resolved', { bugNumber: bugNum, source: 'github-commit', commit: commit.id.slice(0,7) });
      }
    }
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════
//  SENTRY WEBHOOK
// ══════════════════════════════════════════════════════
router.post('/sentry', rawBody, (req, res) => {
  const db = getDb();
  const cfg = JSON.parse(db.prepare("SELECT config FROM integrations WHERE name='sentry'").get()?.config || '{}');
  const sig = req.headers['sentry-hook-signature'] || '';

  if (cfg.authToken && sig !== crypto.createHmac('sha256', cfg.authToken).update(req.body).digest('hex')) {
    return res.status(401).json({ error: 'Invalid signature.' });
  }

  const payload = JSON.parse(req.body.toString());
  const { action, data } = payload;

  if (action === 'created' && data?.issue) {
    const issue = data.issue;
    const sevMap = { critical: 'critical', error: 'high', warning: 'medium', info: 'low' };
    upsertBugFromExternal('sentry', issue.id, issue.title, sevMap[issue.level] || 'medium', issue.culprit);
  }

  if (action === 'resolved' && data?.issue) {
    const bug = db.prepare("SELECT * FROM bugs WHERE external_refs LIKE ?").get(`%"sentry":"${data.issue.id}"%`);
    if (bug) db.prepare("UPDATE bugs SET status='resolved', resolved_at=? WHERE id=?").run(new Date().toISOString(), bug.id);
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════
//  JIRA WEBHOOK
// ══════════════════════════════════════════════════════
router.post('/jira', rawBody, (req, res) => {
  const payload = JSON.parse(req.body.toString());
  const db = getDb();
  const { webhookEvent, issue } = payload;

  if (!issue) return res.json({ received: true, skipped: 'no issue' });

  const jiraKey = issue.key;
  const sevMap   = { Highest:'critical', High:'high', Medium:'medium', Low:'low', Lowest:'low' };
  const severity = sevMap[issue.fields?.priority?.name] || 'medium';
  const statusName = issue.fields?.status?.name?.toLowerCase() || '';

  if (webhookEvent === 'jira:issue_created') {
    upsertBugFromExternal('jira', jiraKey, issue.fields.summary, severity, issue.fields.description?.content?.[0]?.content?.[0]?.text);
  }

  if (webhookEvent === 'jira:issue_updated') {
    const bug = db.prepare("SELECT * FROM bugs WHERE external_refs LIKE ?").get(`%"jira":"${jiraKey}"%`);
    if (bug && (statusName === 'done' || statusName === 'resolved' || statusName === 'closed')) {
      db.prepare("UPDATE bugs SET status='resolved', resolved_at=? WHERE id=?").run(new Date().toISOString(), bug.id);
      broadcastEvent('bug:resolved', { bugId: bug.id, source: 'jira' });
    }
  }

  res.json({ received: true });
});

// ══════════════════════════════════════════════════════
//  PAGERDUTY WEBHOOK
// ══════════════════════════════════════════════════════
router.post('/pagerduty', rawBody, (req, res) => {
  const payload = JSON.parse(req.body.toString());
  const db = getDb();
  const messages = payload.messages || [];

  for (const msg of messages) {
    if (msg.event === 'incident.trigger') {
      const inc = msg.incident;
      upsertBugFromExternal('pagerduty', inc.id, inc.title, 'critical', inc.description);
    }
    if (msg.event === 'incident.resolve') {
      const bug = db.prepare("SELECT * FROM bugs WHERE external_refs LIKE ?").get(`%"pagerduty":"${msg.incident.id}"%`);
      if (bug) db.prepare("UPDATE bugs SET status='resolved', resolved_at=? WHERE id=?").run(new Date().toISOString(), bug.id);
    }
  }

  res.json({ received: true });
});

module.exports = router;
