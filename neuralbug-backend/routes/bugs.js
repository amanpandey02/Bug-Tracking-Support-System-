// routes/bugs.js — Bug CRUD, filtering, AI actions, bulk ops
'use strict';

const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { broadcastEvent } = require('../services/wsService');

// ── Helper: emit activity + optional WS broadcast ───────────────────────────
function logActivity(db, userId, bugId, action, description) {
  db.prepare('INSERT INTO activity_log (id, user_id, bug_id, action, description) VALUES (?,?,?,?,?)')
    .run(uuid(), userId, bugId, action, description);
  broadcastEvent('activity', { bugId, action, description, userId });
}

// ── GET /api/bugs ────────────────────────────────────────────────────────────
// Query params: status, severity, project, assignee, search, page, limit, sort, order
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const {
    status, severity, project, assignee,
    search = '',
    page = 1, limit = 20,
    sort = 'created_at', order = 'desc',
  } = req.query;

  const allowed_sort = ['created_at','updated_at','severity','status','ai_confidence','bug_id'];
  const safeSort = allowed_sort.includes(sort) ? sort : 'created_at';
  const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

  const conditions = [];
  const params = [];

  if (status)   { conditions.push('b.status = ?');   params.push(status); }
  if (severity) { conditions.push('b.severity = ?'); params.push(severity); }
  if (project)  { conditions.push('b.project = ?');  params.push(project); }
  if (assignee) { conditions.push('b.assignee_id = ?'); params.push(assignee); }
  if (search)   {
    conditions.push('(b.title LIKE ? OR b.bug_id LIKE ? OR b.component LIKE ? OR b.description LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM bugs b ${where}
  `).get(...params).n;

  const bugs = db.prepare(`
    SELECT
      b.*,
      u.first_name || ' ' || u.last_name AS assignee_name,
      u.avatar_initials AS assignee_initials,
      u.avatar_color AS assignee_color,
      r.first_name || ' ' || r.last_name AS reporter_name
    FROM bugs b
    LEFT JOIN users u ON b.assignee_id = u.id
    LEFT JOIN users r ON b.reporter_id = r.id
    ${where}
    ORDER BY b.${safeSort} ${safeOrder}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const formatted = bugs.map(b => ({
    ...b,
    tags: safeJson(b.tags, []),
    attachments: safeJson(b.attachments, []),
    externalRefs: safeJson(b.external_refs, {}),
  }));

  return res.json({
    success: true,
    data: formatted,
    pagination: {
      total, page: parseInt(page), limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// ── GET /api/bugs/stats ──────────────────────────────────────────────────────
router.get('/stats', authenticate, (req, res) => {
  const db = getDb();
  const byStatus = db.prepare(
    "SELECT status, COUNT(*) as count FROM bugs GROUP BY status"
  ).all();
  const bySeverity = db.prepare(
    "SELECT severity, COUNT(*) as count FROM bugs GROUP BY severity"
  ).all();
  const total = db.prepare("SELECT COUNT(*) as n FROM bugs").get().n;
  const resolved = db.prepare("SELECT COUNT(*) as n FROM bugs WHERE status='resolved'").get().n;
  const aiFixed = db.prepare("SELECT COUNT(*) as n FROM bugs WHERE ai_fix IS NOT NULL AND status='resolved'").get().n;

  return res.json({
    success: true,
    data: {
      total, resolved, aiFixed,
      resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
      bySeverity: Object.fromEntries(bySeverity.map(r => [r.severity, r.count])),
    },
  });
});

// ── GET /api/bugs/:id ─────────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const bug = db.prepare(`
    SELECT b.*,
      u.first_name || ' ' || u.last_name AS assignee_name,
      u.avatar_initials AS assignee_initials, u.avatar_color AS assignee_color,
      r.first_name || ' ' || r.last_name AS reporter_name
    FROM bugs b
    LEFT JOIN users u ON b.assignee_id = u.id
    LEFT JOIN users r ON b.reporter_id = r.id
    WHERE b.id = ? OR b.bug_id = ?
  `).get(req.params.id, req.params.id);

  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  const comments = db.prepare(`
    SELECT c.*, u.first_name || ' ' || u.last_name AS author_name, u.avatar_initials
    FROM bug_comments c
    JOIN users u ON c.author_id = u.id
    WHERE c.bug_id = ? ORDER BY c.created_at ASC
  `).all(bug.id);

  const history = db.prepare(`
    SELECT a.*, u.first_name || ' ' || u.last_name AS user_name
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.bug_id = ? ORDER BY a.created_at DESC LIMIT 20
  `).all(bug.id);

  return res.json({
    success: true,
    data: {
      ...bug,
      tags: safeJson(bug.tags, []),
      attachments: safeJson(bug.attachments, []),
      externalRefs: safeJson(bug.external_refs, {}),
      comments,
      history,
    },
  });
});

// ── POST /api/bugs ────────────────────────────────────────────────────────────
router.post('/', authenticate, (req, res) => {
  const db = getDb();
  const {
    title, description, severity = 'medium', component, project,
    environment = 'production', assigneeId, tags = [],
    stepsToReproduce, expectedResult, actualResult,
    browser, os, version, storyPoints = 0,
  } = req.body;

  if (!title) return res.status(400).json({ success: false, error: 'Bug title is required.' });

  // Auto-increment bug_id
  const lastBug = db.prepare("SELECT bug_id FROM bugs ORDER BY bug_id DESC LIMIT 1").get();
  const nextNum = lastBug
    ? parseInt(lastBug.bug_id.replace('BUG-', '')) + 1
    : 1;
  const bugId = `BUG-${String(nextNum).padStart(3, '0')}`;
  const id = uuid();

  db.prepare(`
    INSERT INTO bugs
    (id, bug_id, title, description, severity, status, component, project, environment,
     assignee_id, reporter_id, tags, steps_to_reproduce, expected_result, actual_result,
     browser, os, version, story_points)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(id, bugId, title, description, severity, 'open', component, project,
    environment, assigneeId || null, req.user.id, JSON.stringify(tags),
    stepsToReproduce, expectedResult, actualResult, browser, os, version, storyPoints);

  const bug = db.prepare('SELECT * FROM bugs WHERE id = ?').get(id);
  logActivity(db, req.user.id, id, 'created', `Bug ${bugId} created by ${req.user.first_name}`);
  broadcastEvent('bug:created', { bugId, severity });

  // Auto-trigger AI triage if enabled
  const aiTriage = db.prepare("SELECT value FROM settings WHERE key = 'ai_auto_triage'").get();
  if (aiTriage?.value === 'true') {
    setTimeout(() => triggerAITriage(id, req.user.id), 2000);
  }

  return res.status(201).json({ success: true, data: bug, message: `${bugId} created.` });
});

// ── PUT /api/bugs/:id ─────────────────────────────────────────────────────────
router.put('/:id', authenticate, (req, res) => {
  const db = getDb();
  const bug = db.prepare('SELECT * FROM bugs WHERE id = ? OR bug_id = ?').get(req.params.id, req.params.id);
  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  const fields = ['title','description','severity','status','component','project','environment',
    'assignee_id','tags','steps_to_reproduce','expected_result','actual_result',
    'browser','os','version','story_points'];
  const updates = [];
  const params = [];

  for (const field of fields) {
    const key = field.replace(/_([a-z])/g, (_,c) => c.toUpperCase()); // camelCase input
    const val = req.body[key] ?? req.body[field];
    if (val !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'tags' ? JSON.stringify(val) : val);
    }
  }

  // Handle resolved_at
  if (req.body.status === 'resolved' && bug.status !== 'resolved') {
    updates.push('resolved_at = ?');
    params.push(new Date().toISOString());
  }

  if (!updates.length) return res.status(400).json({ success: false, error: 'No valid fields to update.' });

  params.push(bug.id);
  db.prepare(`UPDATE bugs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  logActivity(db, req.user.id, bug.id, 'updated', `Bug ${bug.bug_id} updated`);
  broadcastEvent('bug:updated', { bugId: bug.id, changes: req.body });

  return res.json({ success: true, data: db.prepare('SELECT * FROM bugs WHERE id = ?').get(bug.id) });
});

// ── PATCH /api/bugs/:id/status ────────────────────────────────────────────────
router.patch('/:id/status', authenticate, (req, res) => {
  const db = getDb();
  const { status } = req.body;
  const validStatuses = ['open','ai-fixing','in-progress','review','resolved','closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const bug = db.prepare('SELECT * FROM bugs WHERE id = ? OR bug_id = ?').get(req.params.id, req.params.id);
  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  const resolvedAt = status === 'resolved' ? new Date().toISOString() : bug.resolved_at;
  db.prepare('UPDATE bugs SET status = ?, resolved_at = ? WHERE id = ?').run(status, resolvedAt, bug.id);
  logActivity(db, req.user.id, bug.id, 'status_change', `Status changed: ${bug.status} → ${status}`);
  broadcastEvent('bug:status', { bugId: bug.id, oldStatus: bug.status, newStatus: status });

  return res.json({ success: true, message: `Status updated to "${status}".` });
});

// ── DELETE /api/bugs/:id ──────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('Admin', 'Team Lead'), (req, res) => {
  const db = getDb();
  const bug = db.prepare('SELECT * FROM bugs WHERE id = ? OR bug_id = ?').get(req.params.id, req.params.id);
  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  db.prepare('DELETE FROM bugs WHERE id = ?').run(bug.id);
  logActivity(db, req.user.id, bug.id, 'deleted', `Bug ${bug.bug_id} deleted`);

  return res.json({ success: true, message: `${bug.bug_id} deleted.` });
});

// ── POST /api/bugs/bulk ───────────────────────────────────────────────────────
router.post('/bulk', authenticate, (req, res) => {
  const { ids, action, value } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ success: false, error: 'Bug IDs array required.' });
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');

  if (action === 'status') {
    const validStatuses = ['open','in-progress','review','resolved','closed'];
    if (!validStatuses.includes(value)) {
      return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }
    db.prepare(`UPDATE bugs SET status = ? WHERE id IN (${placeholders})`).run(value, ...ids);
  } else if (action === 'assign') {
    db.prepare(`UPDATE bugs SET assignee_id = ? WHERE id IN (${placeholders})`).run(value, ...ids);
  } else if (action === 'severity') {
    const valid = ['critical','high','medium','low'];
    if (!valid.includes(value)) return res.status(400).json({ success: false, error: 'Invalid severity.' });
    db.prepare(`UPDATE bugs SET severity = ? WHERE id IN (${placeholders})`).run(value, ...ids);
  } else if (action === 'delete') {
    if (req.user.role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Only admins can bulk delete.' });
    }
    db.prepare(`DELETE FROM bugs WHERE id IN (${placeholders})`).run(...ids);
  } else {
    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  broadcastEvent('bugs:bulk', { action, count: ids.length });
  return res.json({ success: true, message: `Bulk ${action} applied to ${ids.length} bugs.` });
});

// ── POST /api/bugs/:id/comments ───────────────────────────────────────────────
router.post('/:id/comments', authenticate, (req, res) => {
  const db = getDb();
  const { content } = req.body;
  if (!content) return res.status(400).json({ success: false, error: 'Comment content required.' });

  const bug = db.prepare('SELECT id, bug_id FROM bugs WHERE id = ? OR bug_id = ?').get(req.params.id, req.params.id);
  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  const id = uuid();
  db.prepare('INSERT INTO bug_comments (id, bug_id, author_id, content) VALUES (?,?,?,?)')
    .run(id, bug.id, req.user.id, content);
  logActivity(db, req.user.id, bug.id, 'comment', `Comment added on ${bug.bug_id}`);

  const comment = db.prepare(`
    SELECT c.*, u.first_name || ' ' || u.last_name AS author_name, u.avatar_initials
    FROM bug_comments c JOIN users u ON c.author_id = u.id WHERE c.id = ?
  `).get(id);

  return res.status(201).json({ success: true, data: comment });
});

// ── GET /api/bugs/:id/activity ────────────────────────────────────────────────
router.get('/:id/activity', authenticate, (req, res) => {
  const db = getDb();
  const bug = db.prepare('SELECT id FROM bugs WHERE id = ? OR bug_id = ?').get(req.params.id, req.params.id);
  if (!bug) return res.status(404).json({ success: false, error: 'Bug not found.' });

  const activity = db.prepare(`
    SELECT a.*, u.first_name || ' ' || u.last_name AS user_name, u.avatar_initials
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.bug_id = ? ORDER BY a.created_at DESC LIMIT 50
  `).all(bug.id);

  return res.json({ success: true, data: activity });
});

// ── Internal: AI Triage trigger ───────────────────────────────────────────────
async function triggerAITriage(bugId, userId) {
  try {
    const { aiService } = require('../services/aiService');
    await aiService.triage(bugId, userId);
  } catch (e) {
    console.error('[AI Triage] Failed:', e.message);
  }
}

function safeJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
