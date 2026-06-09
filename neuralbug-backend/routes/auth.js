// routes/auth.js — Authentication endpoints
'use strict';

const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// ── Helpers ─────────────────────────────────────────────────────────────────
function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh', {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
}

function userPublic(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    fullName: `${u.first_name} ${u.last_name}`,
    role: u.role,
    avatarInitials: u.avatar_initials,
    avatarColor: u.avatar_color,
    createdAt: u.created_at,
    lastLogin: u.last_login,
  };
}

function logAudit(db, userId, action, ip, ua) {
  db.prepare('INSERT INTO audit_log (id, user_id, action, ip_address, user_agent) VALUES (?,?,?,?,?)')
    .run(uuid(), userId, action, ip, ua);
}

// ── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password || '')) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.' });
  }

  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);

  // Store refresh token
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)')
    .run(uuid(), user.id, refreshToken, expiresAt);

  // Update last login
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);
  logAudit(db, user.id, 'auth:login', req.ip, req.get('user-agent'));

  return res.json({
    success: true,
    user: userPublic(user),
    accessToken,
    refreshToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
});

// ── POST /api/auth/register ─────────────────────────────────────────────────
router.post('/register', (req, res) => {
  const { email, password, firstName, lastName, role } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, error: 'All fields are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const db = getDb();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (exists) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
  }

  const validRoles = ['Developer', 'QA Engineer', 'Team Lead', 'DevOps', 'Project Manager'];
  const userRole = validRoles.includes(role) ? role : 'Developer';
  const hash = bcrypt.hashSync(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  const id = uuid();
  const initials = (firstName[0] + lastName[0]).toUpperCase();
  const colors = ['#00f5a0','#00d4ff','#a855f7','#ffa800','#ff6b6b'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  db.prepare(`
    INSERT INTO users (id, email, password, first_name, last_name, role, avatar_initials, avatar_color, is_active, is_verified)
    VALUES (?,?,?,?,?,?,?,?,1,0)
  `).run(id, email.toLowerCase().trim(), hash, firstName.trim(), lastName.trim(), userRole, initials, color);

  // Initialize default user settings
  db.prepare('INSERT INTO user_settings (user_id, settings) VALUES (?,?)').run(id, JSON.stringify({
    theme: 'dark', notifications: { email: true, push: true }
  }));

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const accessToken = signAccessToken(id);
  const refreshToken = signRefreshToken(id);

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)')
    .run(uuid(), id, refreshToken, expiresAt);

  logAudit(db, id, 'auth:register', req.ip, req.get('user-agent'));

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    user: userPublic(user),
    accessToken,
    refreshToken,
  });
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());

  // Always return success to prevent email enumeration
  if (user) {
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?')
      .run(token, expires, user.id);

    // In production: send email with reset link
    // emailService.sendPasswordReset(email, token);
    console.log(`[Auth] Password reset token for ${email}: ${token}`);
    logAudit(db, user.id, 'auth:forgot-password', req.ip, req.get('user-agent'));
  }

  return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
});

// ── POST /api/auth/reset-password ───────────────────────────────────────────
router.post('/reset-password', (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ success: false, error: 'Token and new password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const db = getDb();
  const user = db.prepare(
    'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?'
  ).get(token, new Date().toISOString());

  if (!user) {
    return res.status(400).json({ success: false, error: 'Invalid or expired reset token.' });
  }

  const hash = bcrypt.hashSync(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?')
    .run(hash, user.id);

  // Revoke all refresh tokens
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(user.id);
  logAudit(db, user.id, 'auth:reset-password', req.ip, req.get('user-agent'));

  return res.json({ success: true, message: 'Password reset successfully. Please sign in.' });
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required.' });

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh');
    const db = getDb();
    const stored = db.prepare(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > ?'
    ).get(refreshToken, new Date().toISOString());

    if (!stored) return res.status(401).json({ success: false, error: 'Invalid or expired refresh token.' });

    const newAccessToken = signAccessToken(payload.sub);
    return res.json({ success: true, accessToken: newAccessToken });
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid refresh token.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  const { refreshToken } = req.body;
  const db = getDb();
  if (refreshToken) {
    db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(refreshToken);
  }
  logAudit(db, req.user.id, 'auth:logout', req.ip, req.get('user-agent'));
  return res.json({ success: true, message: 'Signed out successfully.' });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const settings = db.prepare('SELECT settings FROM user_settings WHERE user_id = ?').get(req.user.id);
  return res.json({
    success: true,
    user: {
      ...userPublic(user),
      settings: settings ? JSON.parse(settings.settings) : {},
    },
  });
});

// ── POST /api/auth/google ────────────────────────────────────────────────────
// Accepts { idToken } from Google Sign-In; verifies and upserts user
router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ success: false, error: 'Google ID token required.' });

  try {
    // In production: verify with google-auth-library
    // const { OAuth2Client } = require('google-auth-library');
    // const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    // const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    // const { sub, email, given_name, family_name, picture } = ticket.getPayload();

    // Demo: parse the token payload (not secure — use library in production)
    return res.status(501).json({
      success: false,
      error: 'Google OAuth requires GOOGLE_CLIENT_ID configuration. See .env.example.',
      setup: 'https://console.cloud.google.com/apis/credentials',
    });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid Google token.' });
  }
});

// ── PUT /api/auth/change-password ────────────────────────────────────────────
router.put('/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Current and new password required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
  }

  const hash = bcrypt.hashSync(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
  logAudit(db, req.user.id, 'auth:change-password', req.ip, req.get('user-agent'));

  return res.json({ success: true, message: 'Password changed. Please sign in again.' });
});

module.exports = router;
