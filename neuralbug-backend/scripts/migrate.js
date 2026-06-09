// scripts/migrate.js — Creates all tables from scratch
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './database/neuralbug.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `

-- ═══════════════════════════════════════
--  USERS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'Developer'
                CHECK(role IN ('Developer','QA Engineer','Team Lead','DevOps','Project Manager','Admin')),
  avatar_initials TEXT,
  avatar_color    TEXT DEFAULT '#00f5a0',
  is_active   INTEGER NOT NULL DEFAULT 1,
  is_verified INTEGER NOT NULL DEFAULT 0,
  google_id   TEXT,
  last_login  TEXT,
  reset_token TEXT,
  reset_token_expires TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  REFRESH TOKENS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  BUGS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS bugs (
  id            TEXT PRIMARY KEY,
  bug_id        TEXT UNIQUE NOT NULL,           -- e.g. BUG-001
  title         TEXT NOT NULL,
  description   TEXT,
  severity      TEXT NOT NULL DEFAULT 'medium'
                  CHECK(severity IN ('critical','high','medium','low')),
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK(status IN ('open','ai-fixing','in-progress','review','resolved','closed')),
  component     TEXT,
  project       TEXT,
  environment   TEXT DEFAULT 'production',
  ai_confidence INTEGER DEFAULT 0,
  ai_fix        TEXT,
  ai_root_cause TEXT,
  assignee_id   TEXT REFERENCES users(id),
  reporter_id   TEXT REFERENCES users(id),
  tags          TEXT DEFAULT '[]',              -- JSON array
  attachments   TEXT DEFAULT '[]',             -- JSON array
  external_refs TEXT DEFAULT '{}',             -- JSON: { github, jira, sentry, ... }
  sprint_id     TEXT,
  story_points  INTEGER DEFAULT 0,
  steps_to_reproduce TEXT,
  expected_result    TEXT,
  actual_result      TEXT,
  browser       TEXT,
  os            TEXT,
  version       TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_bugs_status   ON bugs(status);
CREATE INDEX IF NOT EXISTS idx_bugs_severity ON bugs(severity);
CREATE INDEX IF NOT EXISTS idx_bugs_project  ON bugs(project);
CREATE INDEX IF NOT EXISTS idx_bugs_assignee ON bugs(assignee_id);

-- ═══════════════════════════════════════
--  BUG COMMENTS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS bug_comments (
  id        TEXT PRIMARY KEY,
  bug_id    TEXT NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  content   TEXT NOT NULL,
  is_ai     INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  ACTIVITY LOG
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  bug_id      TEXT REFERENCES bugs(id),
  action      TEXT NOT NULL,
  description TEXT,
  meta        TEXT DEFAULT '{}',    -- JSON extra data
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_bug  ON activity_log(bug_id);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);

-- ═══════════════════════════════════════
--  NOTIFICATIONS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('critical','ai','info','warning','success')),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  bug_id      TEXT REFERENCES bugs(id),
  is_read     INTEGER NOT NULL DEFAULT 0,
  icon        TEXT DEFAULT '🔔',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ═══════════════════════════════════════
--  SPRINTS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS sprints (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  goal        TEXT,
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  status      TEXT DEFAULT 'active' CHECK(status IN ('planned','active','completed')),
  story_points_total INTEGER DEFAULT 0,
  story_points_done  INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  SETTINGS (per-workspace key-value)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  INTEGRATIONS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS integrations (
  id            TEXT PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,
  is_enabled    INTEGER NOT NULL DEFAULT 0,
  config        TEXT NOT NULL DEFAULT '{}',   -- JSON, encrypted in prod
  status        TEXT DEFAULT 'disconnected'
                  CHECK(status IN ('connected','disconnected','error','pending')),
  last_sync     TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  USER SETTINGS (per-user preferences)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_settings (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings  TEXT NOT NULL DEFAULT '{}'    -- JSON blob
);

-- ═══════════════════════════════════════
--  API KEYS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL,
  prefix      TEXT NOT NULL,             -- first 8 chars, safe to show
  name        TEXT NOT NULL DEFAULT 'Default',
  last_used   TEXT,
  expires_at  TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ═══════════════════════════════════════
--  AUDIT LOG
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  action      TEXT NOT NULL,
  resource    TEXT,
  resource_id TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  meta        TEXT DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Triggers to update updated_at
CREATE TRIGGER IF NOT EXISTS bugs_updated_at
  AFTER UPDATE ON bugs
  BEGIN UPDATE bugs SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS users_updated_at
  AFTER UPDATE ON users
  BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER IF NOT EXISTS integrations_updated_at
  AFTER UPDATE ON integrations
  BEGIN UPDATE integrations SET updated_at = datetime('now') WHERE id = NEW.id; END;
`;

db.exec(schema);
console.log('✅ Database schema created:', DB_PATH);
db.close();
