// middleware/auth.js — JWT authentication & role guards
'use strict';

const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');

/**
 * Verify JWT from Authorization header.
 * Attaches req.user = { id, email, role, first_name, last_name }
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required. No token provided.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDb();
    const user = db.prepare(
      'SELECT id, email, role, first_name, last_name, avatar_initials, avatar_color, is_active FROM users WHERE id = ?'
    ).get(payload.sub);

    if (!user) return res.status(401).json({ success: false, error: 'User not found.' });
    if (!user.is_active) return res.status(403).json({ success: false, error: 'Account suspended.' });

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired. Please refresh.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

/**
 * Optional authentication — attaches req.user if token present, but doesn't block
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDb();
    req.user = db.prepare('SELECT id, email, role, first_name, last_name FROM users WHERE id = ?').get(payload.sub);
  } catch (_) { /* ignore */ }
  next();
}

/**
 * Role-based access guard. Pass one or more allowed roles.
 * Usage: requireRole('Admin', 'Team Lead')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Required role: ${roles.join(' or ')}.`,
        yourRole: req.user.role
      });
    }
    next();
  };
}

module.exports = { authenticate, optionalAuth, requireRole };
