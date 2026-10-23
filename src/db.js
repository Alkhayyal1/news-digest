import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SOURCES } from './sources.js';
import { COMPANIES } from './core/lexicon.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  db.hasFts = setupFts(db);
  seed(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    tx(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

// FTS5 is compiled into Node's bundled SQLite; if a build lacks it we fall back to LIKE search.
function setupFts(db) {
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      title, body, tags, entities, event_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')`);
    return true;
  } catch (e) {
    console.warn('[db] FTS5 unavailable, using LIKE search:', e.message);
    db.exec('CREATE TABLE IF NOT EXISTS events_search (event_id INTEGER PRIMARY KEY, title TEXT, body TEXT, tags TEXT, entities TEXT)');
    return false;
  }
}

function seed(db) {
  const now = Date.now();
  const insSrc = db.prepare(`INSERT OR IGNORE INTO sources (key, name, url, type, language, default_scope, section_hint, is_official, enabled, allowed_hosts, link_pattern, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of DEFAULT_SOURCES) {
    insSrc.run(s.key, s.name, s.url, s.type, s.language, s.default_scope, s.section_hint ?? null, s.is_official ? 1 : 0, s.enabled ? 1 : 0, JSON.stringify(s.allowed_hosts), s.link_pattern ?? null, s.notes ?? null, now, now);
  }
  const insCo = db.prepare('INSERT OR IGNORE INTO companies (symbol, name, sector, aliases_json) VALUES (?, ?, ?, ?)');
  for (const c of COMPANIES) insCo.run(c.symbol, c.name, c.sector, JSON.stringify(c.aliases));
}

// Static (GitHub) mode: src/sources.js is the source of truth, so existing rows are updated
// from it on every run. Runtime health fields (last_success_at, errors) are left untouched.
export function syncSources(db, list = DEFAULT_SOURCES) {
  const now = Date.now();
  const up = db.prepare(`UPDATE sources SET name = ?, url = ?, type = ?, language = ?, default_scope = ?, section_hint = ?, is_official = ?, enabled = ?,
      allowed_hosts = ?, link_pattern = ?, notes = ?, updated_at = ? WHERE key = ?`);
  for (const s of list) {
    up.run(s.name, s.url, s.type, s.language, s.default_scope, s.section_hint ?? null, s.is_official ? 1 : 0, s.enabled ? 1 : 0,
      JSON.stringify(s.allowed_hosts), s.link_pattern ?? null, s.notes ?? null, now, s.key);
  }
  seed(db);
}

// node:sqlite has no transaction helper; nested calls join the outer transaction.
const txDepth = new WeakMap();
export function tx(db, fn) {
  const d = txDepth.get(db) || 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    txDepth.set(db, 0);
  }
}

export function getSetting(db, key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export const J = (s, d = null) => {
  if (s == null) return d;
  try {
    return JSON.parse(s);
  } catch {
    return d;
  }
};
