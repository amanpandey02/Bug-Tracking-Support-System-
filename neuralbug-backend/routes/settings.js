// routes/settings.js
'use strict';
const router = require('express').Router();
const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate, requireRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

// GET /api/settings
router.get('/', authenticate, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value, category FROM settings ORDER BY category, key').all();
  const grouped = rows.reduce((acc, r) => {
    if (!acc[r.category]) acc[r.category] = {};
    acc[r.category][r.key] = r.value;
    return acc;
  }, {});
  return res.json({ success: true, data: grouped });
});

// PUT /api/settings/:category
router.put('/:category', authenticate, requireRole('Admin', 'Team Lead'), (req, res) => {
  const db = getDb();
  const cat = req.params.category;
  const updates = req.body;
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value, category, updated_at) VALUES (?,?,?,?)');
  const insertMany = db.transaction((entries) => {
    for (const [key, value] of entries) stmt.run(key, String(value), cat, new Date().toISOString());
  });
  insertMany(Object.entries(updates));
  return res.json({ success: true, message: `${cat} settings saved.`, data: updates });
});

// GET /api/settings/user (per-user preferences)
router.get('/user/me', authenticate, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(req.user.id);
  const settings = row ? JSON.parse(row.settings) : {};
  return res.json({ success: true, data: settings });
});

// PUT /api/settings/user/me
router.put('/user/me', authenticate, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(req.user.id);
  const current = existing ? JSON.parse(existing.settings) : {};
  const merged = { ...current, ...req.body };
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, settings) VALUES (?,?)').run(req.user.id, JSON.stringify(merged));
  return res.json({ success: true, data: merged });
});

// GET /api/settings/api-keys
router.get('/api-keys', authenticate, (req, res) => {
  const db = getDb();
  const keys = db.prepare(
    'SELECT id, prefix, name, last_used, expires_at, is_active, created_at FROM api_keys WHERE user_id = ?'
  ).all(req.user.id);
  return res.json({ success: true, data: keys });
});

// POST /api/settings/api-keys
router.post('/api-keys', authenticate, (req, res) => {
  const { name } = req.body;
  const db = getDb();
  const rawKey = 'nb_sk_live_' + require('crypto').randomBytes(24).toString('hex');
  const prefix = rawKey.slice(0, 16);
  const hash = bcrypt.hashSync(rawKey, 8);
  const id = uuid();
  db.prepare('INSERT INTO api_keys (id, user_id, key_hash, prefix, name) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, hash, prefix, name || 'Default');
  return res.status(201).json({ success: true, key: rawKey, prefix, message: 'Save this key — it will not be shown again.' });
});

// DELETE /api/settings/api-keys/:id
router.delete('/api-keys/:id', authenticate, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  return res.json({ success: true, message: 'API key revoked.' });
});

module.exports = router;
