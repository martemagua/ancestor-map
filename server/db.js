// Schema + migrations. Everything lives in one SQLite file under DATA_DIR.
//
// The discipline is Friend-Map's: base tables are CREATE TABLE IF NOT EXISTS
// and never edited; later columns arrive through ensureColumn() at boot; data
// migrations are meta-flagged transactions (check flag → one transaction →
// set flag), so a second boot never undoes what somebody has since moved.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

// The single most common self-hosting failure is a data directory the
// container user cannot write — say so in one plain sentence instead of a
// stack trace, because this is the first line anyone sees in the app logs.
try {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
} catch {
  const who = `uid ${process.getuid?.() ?? '?'} / gid ${process.getgid?.() ?? '?'}`;
  console.error(
    `The data directory ${DATA_DIR} is not writable by the container user (${who}).\n`
    + `Fix the ownership of the host folder mounted there, e.g. on TrueNAS:\n`
    + `  sudo chown -R ${process.getuid?.() ?? 568}:${process.getgid?.() ?? 568} /path/to/your/dataset\n`
    + `then restart the app.`,
  );
  process.exit(1);
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'ancestormap.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  -- viewer | editor | admin — checked server-side on every route (index.js).
  role TEXT NOT NULL DEFAULT 'editor',
  email TEXT DEFAULT '',
  lang TEXT DEFAULT '',
  person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,          -- sha256 of the cookie value, never the value
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sex TEXT DEFAULT '',             -- 'm' | 'f' | '' — kinship words read it
  -- Fuzzy date text is the source of truth (public/js/fuzzydate.js); the
  -- *_year integers are derived on every write and exist only for sorting
  -- and the Zeit layout. Don't write them by hand.
  birth TEXT DEFAULT '',
  birth_year INTEGER,
  death TEXT DEFAULT '',
  death_year INTEGER,
  birth_place TEXT DEFAULT '',
  birth_lat REAL, birth_lon REAL,
  death_place TEXT DEFAULT '',
  death_lat REAL, death_lon REAL,
  archived INTEGER DEFAULT 0,
  x REAL, y REAL,                  -- persisted map position (Generationen mode)
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Everything on a person that is not structural. One row per person, per
-- owner, per field — user_id 0 is the documented record, anything else is
-- that account's own note or hypothesis. public/js/fields.js is the registry.
CREATE TABLE IF NOT EXISTS person_fields (
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (person_id, user_id, key)
);
-- A marriage/partnership as a first-class node. Children hang off a union,
-- never off two loose parent edges — a single known parent is a one-partner
-- union, which is also how GEDCOM sees the world.
CREATE TABLE IF NOT EXISTS unions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'unbekannt',   -- ehe | partnerschaft | unbekannt
  started TEXT DEFAULT '',                  -- fuzzy date text, like persons.birth
  started_year INTEGER,
  ended TEXT DEFAULT '',
  ended_year INTEGER,
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS union_partners (
  union_id INTEGER NOT NULL REFERENCES unions(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  PRIMARY KEY (union_id, person_id)
);
CREATE TABLE IF NOT EXISTS children (
  union_id INTEGER NOT NULL REFERENCES unions(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'leiblich',    -- leiblich | adoptiert | stief | pflege
  PRIMARY KEY (union_id, child_id)
);
-- Free-form described links — godmother, exchange family, emigrated together.
-- Deliberately separate from the tree structure; a person may hang on nothing
-- but one of these. Undirected: pair() stores the lower id in a_id.
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY,
  a_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  b_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'sonstig',
  label TEXT DEFAULT '',                    -- what this relationship entails
  UNIQUE (a_id, b_id)
);
-- Lineages/branches as toggleable layers. They nest like Friend-Map's
-- circles: membership is stored only at the innermost branch and inherited
-- upward, and a ring is refused at write and at import.
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#A6743C',
  emoji TEXT DEFAULT '',
  parent_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
  sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS person_branches (
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, branch_id)
);
-- Life events and anecdotes — one table for both, like Friend-Map's moments.
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'erlebnis',
  date TEXT DEFAULT '',                     -- fuzzy date text
  date_year INTEGER,
  place TEXT DEFAULT '',
  lat REAL, lon REAL,
  text TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS story_people (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, person_id)
);
-- Where a fact comes from. Linked to persons/unions/stories via source_links.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  url TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS source_links (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,               -- person | union | story
  subject_id INTEGER NOT NULL,
  PRIMARY KEY (source_id, subject_type, subject_id)
);
CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT );
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Long-lived read keys for other machines (automation, the MCP server). Only
-- the hash is kept: what is in here cannot be handed back out.
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Invitation links for the family. Hash-only, single-use, expiring — the same
-- discipline as password resets; the role travels with the invite.
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'viewer',
  invited_name TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
-- Nominatim asks that results be cached rather than re-requested.
CREATE TABLE IF NOT EXISTS geocache (
  q TEXT PRIMARY KEY,
  result TEXT NOT NULL,
  at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rel_a ON relationships(a_id);
CREATE INDEX IF NOT EXISTS idx_rel_b ON relationships(b_id);
CREATE INDEX IF NOT EXISTS idx_children_child ON children(child_id);
CREATE INDEX IF NOT EXISTS idx_up_person ON union_partners(person_id);
CREATE INDEX IF NOT EXISTS idx_sp_person ON story_people(person_id);
CREATE INDEX IF NOT EXISTS idx_person_fields_key ON person_fields(key);
CREATE INDEX IF NOT EXISTS idx_stories_year ON stories(date_year);
`);

// Idempotent column adds — the migration path for anything introduced later.
export function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}

export const metaGet = (k, dflt = null) =>
  (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value ?? dflt;
export const metaSet = (k, v) =>
  db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)').run(k, String(v));

/** True until the first user account exists — the app then shows the setup wizard. */
export const needsSetup = () => db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;

// Relationships are undirected: always store the lower id in a_id so the
// UNIQUE(a_id,b_id) constraint actually prevents duplicate pairs.
export const pair = (x, y) => (Number(x) < Number(y) ? [Number(x), Number(y)] : [Number(y), Number(x)]);

/**
 * One transaction, rolled back on any throw. All multi-write routes use it.
 *
 * Re-entrant: SQLite has no nested BEGIN, but the write handlers are meant
 * to compose — seeding the demo family calls createPerson forty times, and
 * each of those wants a transaction of its own. Only the outermost call
 * actually begins and commits, so the whole batch still lands or doesn't.
 */
let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) {
    txDepth++;
    try { return fn(); } finally { txDepth--; }
  }
  db.exec('BEGIN');
  txDepth = 1;
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth = 0;
  }
}

// Suggested to new branches, unused colours first — two branches in one colour
// are two blobs on the map you cannot tell apart. Shipped to the browser via
// /api/settings so the list exists once.
export const BRANCH_PALETTE = [
  '#A6743C', '#3E7CB1', '#D1495B', '#5AA469', '#8E6BAD',
  '#3FA7A0', '#E8833A', '#E0A13B', '#C2557A', '#6C8EBF',
];
