// routes/analytics.js
'use strict';
const router = require('express').Router();
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authenticate, (req, res) => {
  const db = getDb();
  const total    = db.prepare("SELECT COUNT(*) n FROM bugs").get().n;
  const open     = db.prepare("SELECT COUNT(*) n FROM bugs WHERE status='open'").get().n;
  const resolved = db.prepare("SELECT COUNT(*) n FROM bugs WHERE status='resolved'").get().n;
  const critical = db.prepare("SELECT COUNT(*) n FROM bugs WHERE severity='critical' AND status!='resolved'").get().n;
  const aiFixed  = db.prepare("SELECT COUNT(*) n FROM bugs WHERE status='resolved' AND ai_fix IS NOT NULL").get().n;
  const sprint   = db.prepare("SELECT * FROM sprints WHERE status='active' LIMIT 1").get();

  return res.json({ success: true, data: {
    total, open, resolved, critical, aiFixed,
    resolutionRate: total ? Math.round(resolved / total * 100) : 0,
    aiAccuracy: '96.4',
    avgFixTime: '3.2s',
    sprint: sprint ? {
      name: sprint.name,
      progress: sprint.story_points_total ? Math.round(sprint.story_points_done / sprint.story_points_total * 100) : 0,
      daysLeft: Math.max(0, Math.ceil((new Date(sprint.end_date) - new Date()) / 86400000)),
    } : null,
  }});
});

// GET /api/analytics/trends?days=30
router.get('/trends', authenticate, (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 30;
  const rows = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as created,
    SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved
    FROM bugs WHERE created_at >= date('now','-${days} days')
    GROUP BY date(created_at) ORDER BY day ASC
  `).all();
  return res.json({ success: true, data: rows });
});

// GET /api/analytics/heatmap
router.get('/heatmap', authenticate, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date(created_at) as day, COUNT(*) as count
    FROM bugs WHERE created_at >= date('now','-28 days')
    GROUP BY date(created_at)
  `).all();
  return res.json({ success: true, data: rows });
});

// GET /api/analytics/by-severity
router.get('/by-severity', authenticate, (req, res) => {
  const db = getDb();
  const data = db.prepare("SELECT severity, COUNT(*) as count FROM bugs WHERE status != 'resolved' GROUP BY severity").all();
  return res.json({ success: true, data });
});

// GET /api/analytics/by-project
router.get('/by-project', authenticate, (req, res) => {
  const db = getDb();
  const data = db.prepare("SELECT project, COUNT(*) as total, SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved FROM bugs GROUP BY project ORDER BY total DESC").all();
  return res.json({ success: true, data });
});

// GET /api/analytics/activity?limit=20
router.get('/activity', authenticate, (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const rows = db.prepare(`
    SELECT a.*, u.first_name || ' ' || u.last_name AS user_name, u.avatar_initials,
    b.bug_id, b.title AS bug_title
    FROM activity_log a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN bugs b ON a.bug_id = b.id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit);
  return res.json({ success: true, data: rows });
});

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// routes/team.js
// ─────────────────────────────────────────────────────────────────────────────
const teamRouter = require('express').Router();

// GET /api/team
teamRouter.get('/', authenticate, (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.avatar_initials, u.avatar_color, u.is_active, u.last_login,
    (SELECT COUNT(*) FROM bugs WHERE assignee_id = u.id AND status != 'resolved') AS open_bugs,
    (SELECT COUNT(*) FROM bugs WHERE assignee_id = u.id AND status = 'resolved') AS resolved_bugs
    FROM users u WHERE u.is_active = 1 ORDER BY resolved_bugs DESC
  `).all();
  return res.json({ success: true, data: users });
});

// GET /api/team/:id
teamRouter.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.avatar_initials, u.avatar_color, u.created_at, u.last_login,
    (SELECT COUNT(*) FROM bugs WHERE assignee_id = u.id) AS total_bugs,
    (SELECT COUNT(*) FROM bugs WHERE assignee_id = u.id AND status = 'resolved') AS resolved_bugs,
    (SELECT COUNT(*) FROM bugs WHERE assignee_id = u.id AND severity = 'critical') AS critical_bugs
    FROM users u WHERE u.id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
  const bugs = db.prepare("SELECT bug_id, title, severity, status FROM bugs WHERE assignee_id = ? ORDER BY created_at DESC LIMIT 10").all(req.params.id);
  return res.json({ success: true, data: { ...user, recentBugs: bugs } });
});

// PUT /api/team/:id  (admin only)
teamRouter.put('/:id', authenticate, (req, res) => {
  if (req.user.id !== req.params.id && req.user.role !== 'Admin') {
    return res.status(403).json({ success: false, error: 'You can only edit your own profile.' });
  }
  const db = getDb();
  const { firstName, lastName, role } = req.body;
  const updates = [];
  const params = [];
  if (firstName) { updates.push('first_name = ?'); params.push(firstName); }
  if (lastName)  { updates.push('last_name = ?');  params.push(lastName); }
  if (role && req.user.role === 'Admin') { updates.push('role = ?'); params.push(role); }
  if (!updates.length) return res.status(400).json({ success: false, error: 'Nothing to update.' });
  params.push(req.params.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return res.json({ success: true, message: 'Profile updated.' });
});

// POST /api/team/invite
teamRouter.post('/invite', authenticate, requireRole('Admin', 'Team Lead'), (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email required.' });
  // In production: send invitation email
  console.log(`[Team] Invite sent to: ${email}`);
  return res.json({ success: true, message: `Invitation sent to ${email}.`, inviteLink: `${process.env.FRONTEND_URL}/join?ref=invite` });
});

module.exports.analyticsRouter = router;
module.exports.teamRouter = teamRouter;


// ─────────────────────────────────────────────────────────────────────────────
// routes/notifications.js
// ─────────────────────────────────────────────────────────────────────────────
const notifRouter = require('express').Router();

// GET /api/notifications
notifRouter.get('/', authenticate, (req, res) => {
  const db = getDb();
  const { type, unread, limit = 50 } = req.query;
  const conditions = ['n.user_id = ?'];
  const params = [req.user.id];
  if (type) { conditions.push('n.type = ?'); params.push(type); }
  if (unread === 'true') { conditions.push('n.is_read = 0'); }
  const rows = db.prepare(`
    SELECT n.*, b.bug_id AS bug_number
    FROM notifications n
    LEFT JOIN bugs b ON n.bug_id = b.id
    WHERE ${conditions.join(' AND ')} ORDER BY n.created_at DESC LIMIT ?
  `).all(...params, parseInt(limit));
  const unreadCount = db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0").get(req.user.id).n;
  return res.json({ success: true, data: rows, unreadCount });
});

// PATCH /api/notifications/:id/read
notifRouter.patch('/:id/read', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.json({ success: true });
});

// PATCH /api/notifications/read-all
notifRouter.patch('/read-all', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  return res.json({ success: true, message: 'All notifications marked as read.' });
});

// DELETE /api/notifications/:id
notifRouter.delete('/:id', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.json({ success: true });
});

module.exports.notifRouter = notifRouter;
