// middleware/validate.js — Input validation helpers using express-validator
'use strict';

const { validationResult, body } = require('express-validator');

/**
 * Run validation result check and return 422 on failure.
 * Use after express-validator chains.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      error: 'Validation failed.',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ── Reusable validation chains ────────────────────────────────────────────────
const loginRules = [
  body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password required.'),
];

const registerRules = [
  body('email').isEmail().withMessage('Valid email required.').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('firstName').trim().notEmpty().withMessage('First name required.'),
  body('lastName').trim().notEmpty().withMessage('Last name required.'),
];

const bugCreateRules = [
  body('title').trim().isLength({ min: 5, max: 200 }).withMessage('Title must be 5–200 characters.'),
  body('severity').optional().isIn(['critical','high','medium','low']).withMessage('Invalid severity.'),
  body('storyPoints').optional().isInt({ min: 0, max: 100 }).withMessage('Story points 0–100.'),
];

module.exports = { validate, loginRules, registerRules, bugCreateRules };
