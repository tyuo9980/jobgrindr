'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'jobgrindr.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Timestamps are epoch milliseconds (INTEGER); calendar dates are yyyy-mm-dd TEXT.
const NOW_MS = "CAST(unixepoch('now','subsec') * 1000 AS INTEGER)";

/**
 * Migrations are .sql files named <version>_<label>.sql, applied in numeric
 * order. To change the schema, add a new file — never edit an applied one.
 */
function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => {
      const match = /^(\d+)/.exec(name);
      if (!match) throw new Error(`migration ${name} must start with a version number`);
      return {
        version: Number(match[1]),
        name,
        sql: fs.readFileSync(path.join(dir, name), 'utf8'),
      };
    })
    .sort((a, b) => a.version - b.version);
}

function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER NOT NULL)'
  );

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );
  const record = db.prepare(
    `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ${NOW_MS})`
  );

  for (const { version, name, sql } of loadMigrations(dir)) {
    if (applied.has(version)) continue;

    // Each migration is all-or-nothing: a half-applied schema is worse than none.
    db.exec('BEGIN');
    try {
      db.exec(sql);
      record.run(version, name);
      db.exec('COMMIT');
      console.log(`migration ${name} applied`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${name} failed: ${err.message}`, { cause: err });
    }
  }
}

function open(dbPath = DB_PATH) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

module.exports = { open, migrate, loadMigrations, DB_PATH, NOW_MS };
