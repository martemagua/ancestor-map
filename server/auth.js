// Accounts + sessions + invites. scrypt from node:crypto, httpOnly cookie,
// hash-only storage for every secret — session, reset, invite, API token.
// Ported from Friend-Map, extended with roles, e-mail and invitations.
import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 90;
const COOKIE = 'am_session';

export const ROLES = ['viewer', 'editor', 'admin'];
const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };

export const safeRole = (v, fallback = 'viewer') => (ROLES.includes(v) ? v : fallback);
export const atLeast = (user, role) => Boolean(user) && (ROLE_RANK[user.role] ?? -1) >= ROLE_RANK[role];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

export function createUser({ username, password, role = 'editor', email = '', lang = '', person_id = null }) {
  const r = db.prepare('INSERT INTO users (username, pass_hash, role, email, lang, person_id) VALUES (?,?,?,?,?,?)')
    .run(String(username).trim(), hashPassword(password), safeRole(role, 'editor'),
      String(email || '').trim(), String(lang || ''), person_id);
  return Number(r.lastInsertRowid);
}

export function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  // Hash anyway on a miss so a wrong username and a wrong password cost the same.
  if (!u) { hashPassword(String(password || '')); return null; }
  if (!verifyPassword(password, u.pass_hash)) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  // Only the hash lands in the database — a session lives 90 days, and a
  // nightly backup is a file that leaves the machine.
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token), u.id, expires);
  return { token, user: publicUser(u) };
}

export function logout(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));
}

export function userFromRequest(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(hashToken(token));
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token=?').run(s.token);
    return null;
  }
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  return u ? publicUser(u) : null;
}

export function publicUser(u) {
  return { id: u.id, username: u.username, role: safeRole(u.role), email: u.email || '', lang: u.lang || '', person_id: u.person_id };
}

export function sessionCookie(token, secure) {
  const bits = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
export const COOKIE_NAME = COOKIE;

export function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      // A hand-mangled percent sequence must not 500 every request — login
      // included, which is the one door left for getting a fresh cookie.
      try { return decodeURIComponent(value); } catch { return value; }
    }
  }
  return null;
}

export function purgeExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.prepare("DELETE FROM password_resets WHERE expires_at < datetime('now','-1 day')").run();
  db.prepare("DELETE FROM invites WHERE expires_at < datetime('now','-7 day')").run();
}

// ------------------------------------------------------------------ users

const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

export function listUsers() {
  return db.prepare('SELECT id, username, role, email, lang, person_id, created_at FROM users ORDER BY id').all();
}

export const userCount = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;
export const adminCount = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;

export function findUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(Number(id));
  return u ? publicUser(u) : null;
}

/** Changing a password signs that account out everywhere, including here. */
export function updateUser(id, { username, password, role, email, lang, person_id }) {
  const sets = [], vals = [];
  if (username !== undefined) { sets.push('username=?'); vals.push(String(username).trim()); }
  if (role !== undefined) { sets.push('role=?'); vals.push(safeRole(role)); }
  if (email !== undefined) { sets.push('email=?'); vals.push(String(email || '').trim()); }
  if (lang !== undefined) { sets.push('lang=?'); vals.push(String(lang || '')); }
  if (person_id !== undefined) { sets.push('person_id=?'); vals.push(person_id ?? null); }
  if (password) { sets.push('pass_hash=?'); vals.push(hashPassword(password)); }
  if (sets.length) db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals, Number(id));
  if (password) db.prepare('DELETE FROM sessions WHERE user_id=?').run(Number(id));
  return findUser(id);
}

/** Sessions cascade; the linked person stays in the tree. */
export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id=?').run(Number(id));
  return { ok: true };
}

// ------------------------------------------------------------------ recovery

const RESET_MINUTES = 30;

/**
 * Mint a single-use reset token. Only the hash is stored, so a stolen database
 * doesn't hand over working links.
 */
export function createResetToken(username) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!user) return null;
  // One live token per account: asking again invalidates the previous one.
  db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + RESET_MINUTES * 60_000).toISOString();
  db.prepare('INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(hashToken(token), user.id, expires);
  return { token, user: publicUser(user), minutes: RESET_MINUTES };
}

export function checkResetToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=?').get(hashToken(token));
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  return user ? { row, user: publicUser(user) } : null;
}

/** Set a new password and sign every device out — including whoever took it. */
export function useResetToken(token, password) {
  const found = checkResetToken(token);
  if (!found) return null;
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(password), found.user.id);
  db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE token_hash=?").run(hashToken(token));
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(found.user.id);
  return found.user;
}

// ------------------------------------------------------------------ invites

const INVITE_DAYS = 14;

/**
 * An invitation link for a family member. Single-use, expiring, hash-only —
 * the role rides on the invite, so the admin decides it when creating the
 * link, not whoever clicks it.
 */
export function createInvite({ role = 'viewer', invited_name = '', created_by = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO invites (token_hash,role,invited_name,created_by,expires_at) VALUES (?,?,?,?,?)')
    .run(hashToken(token), safeRole(role), String(invited_name || '').trim().slice(0, 80), created_by, expires);
  return { token, role: safeRole(role), days: INVITE_DAYS };
}

export function checkInvite(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM invites WHERE token_hash=?').get(hashToken(token));
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

/** Spend the invite; the caller creates the account inside the same transaction. */
export function consumeInvite(token) {
  const row = checkInvite(token);
  if (!row) return null;
  db.prepare("UPDATE invites SET used_at=datetime('now') WHERE token_hash=?").run(row.token_hash);
  return row;
}

export function listInvites() {
  return db.prepare(`SELECT token_hash, role, invited_name, created_by, expires_at, used_at, created_at
    FROM invites ORDER BY created_at DESC`).all();
}

export const deleteInvite = tokenHash => {
  db.prepare('DELETE FROM invites WHERE token_hash=?').run(String(tokenHash));
  return { ok: true };
};

// ---------------------------------------------------------------- API tokens

/**
 * A long-lived key for another machine — an automation, the MCP server. It
 * stands in for its account on read-only routes and nothing else; which ones
 * is decided in index.js, next to PUBLIC_ROUTES.
 */
export function createApiToken(userId, name) {
  const token = `am_${crypto.randomBytes(32).toString('base64url')}`;
  const r = db.prepare('INSERT INTO api_tokens (user_id,name,token_hash) VALUES (?,?,?)')
    .run(Number(userId), String(name || 'Automation').trim().slice(0, 60) || 'Automation', hashToken(token));
  return { id: Number(r.lastInsertRowid), token };
}

export const listApiTokens = userId => db
  .prepare('SELECT id,user_id,name,created_at,last_used_at FROM api_tokens WHERE user_id=? ORDER BY id')
  .all(Number(userId));

export const deleteApiToken = (id, userId) => {
  db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(Number(id), Number(userId));
  return { ok: true };
};

/**
 * The account behind an `Authorization: Bearer …` (or `X-API-Key`) header, or
 * null. `last_used_at` is written on every hit — the one question you have
 * about an automation months later is whether it is still running.
 */
export function userFromToken(req) {
  const header = req.headers.authorization || '';
  const raw = header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : String(req.headers['x-api-key'] || '').trim();
  if (!raw) return null;
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash=?').get(hashToken(raw));
  if (!row) return null;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id);
  if (!u) return null;
  db.prepare("UPDATE api_tokens SET last_used_at=datetime('now') WHERE id=?").run(row.id);
  return publicUser(u);
}
