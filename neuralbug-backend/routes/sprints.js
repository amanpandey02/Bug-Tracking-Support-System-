// routes/sprints.js — Sprint board management
'use strict';

const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/sprints
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const sprints = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM bugs WHERE sprint_id = s.id) AS total_bugs,
      (SELECT COUNT(*) FROM bugs WHERE sprint_id = s.id AND status = 'resolved') AS resolved_bugs
    FROM sprints s ORDER BY s.start_date DESC
  `).all();
  return res.json({ success: true, data: sprints });
});

// GET /api/sprints/active
router.get('/active', authenticate, (req, res) => {
  const db = getDb();
  const sprint = db.prepare("SELECT * FROM sprints WHERE status = 'active' ORDER BY start_date DESC LIMIT 1").get();
  if (!sprint) return res.status(404).json({ success: false, error: 'No active sprint.' });

  // Get bugs grouped by status for kanban
  const bugs = db.prepare(`
    SELECT b.*, u.first_name || ' ' || u.last_name AS assignee_name, u.avatar_initials
    FROM bugs b
    LEFT JOIN users u ON b.assignee_id = u.id
    WHERE b.sprint_id = ?
    ORDER BY b.severity ASC, b.created_at DESC
  `).all(sprint.id);

  const kanban = {
    open:          bugs.filter(b => b.status === 'open'),
    'in-progress': bugs.filter(b => b.status === 'in-progress'),
    'ai-fixing':   bugs.filter(b => b.status === 'ai-fixing'),
    review:        bugs.filter(b => b.status === 'review'),
    resolved:      bugs.filter(b => b.status === 'resolved'),
  };

  return res.json({ success: true, data: { ...sprint, kanban } });
});

// GET /api/sprints/:id
router.get('/:id', authenticate, (req, res) => {
  const db = getDb();
  const sprint = db.prepare('SELECT * FROM sprints WHERE id = ?').get(req.params.id);
  if (!sprint) return res.status(404).json({ success: false, error: 'Sprint not found.' });
  return res.json({ success: true, data: sprint });
});

// POST /api/sprints
router.post('/', authenticate, requireRole('Admin', 'Team Lead'), (req, res) => {
  const { name, goal, startDate, endDate, storyPointsTotal } = req.body;
  if (!name || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: 'name, startDate, endDate are required.' });
  }
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO sprints (id, name, goal, start_date, end_date, status, story_points_total)
    VALUES (?,?,?,?,?,?,?)
  `).run(id, name, goal, startDate, endDate, 'planned', storyPointsTotal || 0);
  return res.status(201).json({ success: true, data: db.prepare('SELECT * FROM sprints WHERE id = ?').get(id) });
});

// PATCH /api/sprints/:id/status
router.patch('/:id/status', authenticate, requireRole('Admin', 'Team Lead'), (req, res) => {
  const { status } = req.body;
  const valid = ['planned', 'active', 'completed'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, error: `Invalid status.` });
  const db = getDb();
  // Only one sprint active at a time
  if (status === 'active') db.prepare("UPDATE sprints SET status = 'planned' WHERE status = 'active'").run();
  db.prepare('UPDATE sprints SET status = ? WHERE id = ?').run(status, req.params.id);
  return res.json({ success: true, message: `Sprint ${status}.` });
});

// PATCH /api/sprints/:id/move-bug — move bug to different sprint
router.patch('/:id/move-bug', authenticate, (req, res) => {
  const { bugId, targetSprintId } = req.body;
  if (!bugId) return res.status(400).json({ success: false, error: 'bugId required.' });
  const db = getDb();
  db.prepare('UPDATE bugs SET sprint_id = ? WHERE id = ?').run(targetSprintId || null, bugId);
  return res.json({ success: true, message: 'Bug moved.' });
});

module.exports = router;
