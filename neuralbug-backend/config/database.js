// config/database.js — SQLite connection singleton
'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let _db = null;

function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || './database/neuralbug.db';
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === 'development' ? null : null,
  });

  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('cache_size = -32000'); // 32MB cache

  // Graceful shutdown
  process.on('exit', () => { if (_db) _db.close(); });
  process.on('SIGHUP', () => process.exit(128 + 1));
  process.on('SIGINT', () => process.exit(128 + 2));
  process.on('SIGTERM', () => process.exit(128 + 15));

  return _db;
}

module.exports = { getDb };
