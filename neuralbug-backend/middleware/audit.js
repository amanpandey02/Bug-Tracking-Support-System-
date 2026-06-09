// middleware/audit.js — Audit log middleware for sensitive operations
'use strict';

const { v4: uuid } = require('uuid');
const { getDb } = require('../config/database');

/**
 * Logs sensitive user actions to the audit_log table.
 * Use as route-level middleware: router.delete('/:id', audit('bug:delete'), handler)
 */
function audit(action) {
  return (req, res, next) => {
    const db = getDb();
    const orig = res.json.bind(res);
    res.json = (body) => {
      if (body?.success !== false) {
        try {
          db.prepare(`
            INSERT INTO audit_log (id, user_id, action, resource_id, ip_address, user_agent, meta)
            VALUES (?,?,?,?,?,?,?)
          `).run(
            uuid(),
            req.user?.id || null,
            action,
            req.params?.id || null,
            req.ip,
            req.get('user-agent') || '',
            JSON.stringify({ method: req.method, path: req.path, body: sanitizeBody(req.body) })
          );
        } catch (e) { /* don't break response if audit fails */ }
      }
      return orig(body);
    };
    next();
  };
}

function sanitizeBody(body) {
  if (!body) return {};
  const safe = { ...body };
  ['password','newPassword','currentPassword','token','apiKey','secret'].forEach(k => delete safe[k]);
  return safe;
}

module.exports = { audit };
