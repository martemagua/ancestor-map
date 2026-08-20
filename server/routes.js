// The JSON API's write handlers + export/import. Every route here runs behind
// the auth gate in index.js, which also checks the caller's role — handlers
// can assume "allowed", never "harmless".
//
// Errors thrown here carry an i18n *key* ('err.…'), never prose: the client
// renders them in its own language. Anything without a status is a bug of
// ours and surfaces as the generic err.unexpected.
import { db, pair, tx, needsSetup, metaSet, BRANCH_PALETTE } from './db.js';
import {
  createUser, login, logout, hashPassword, verifyPassword, sessionCookie, clearCookie,
  listUsers, findUser, updateUser, deleteUser, adminCount, safeRole,
  createInvite, checkInvite, consumeInvite, listInvites, deleteInvite,
} from './auth.js';
import { fieldsByPerson, kinIndexNow, today } from './queries.js';
import { FIELDS, toStored } from '../public/js/fields.js';
import {
  ids, REL_KINDS as V_REL, UNION_KINDS as V_UNION, UNION_ENDINGS as V_ENDINGS,
  CHILD_ROLES as V_ROLES, STORY_KINDS as V_STORY,
} from '../public/js/vocab.js';
import { sortYear } from '../public/js/fuzzydate.js';

/**
 * The columns a person actually has. Everything else about them lives in
 * `person_fields`, described once in public/js/fields.js. The *_year columns
 * are deliberately absent: they are derived from the fuzzy text here, never
 * accepted from a client.
 */
const PERSON_COLS = ['name', 'sex', 'birth', 'death', 'birth_place', 'birth_lat', 'birth_lon',
  'death_place', 'death_lat', 'death_lon', 'archived', 'x', 'y'];
// The vocabularies come from the one list both sides read — see vocab.js. A
// kind the form offers and the server refuses is a bug that only shows up
// with a real family in front of you.
export const REL_KINDS = ids(V_REL);
export const UNION_KINDS = ids(V_UNION);
export const UNION_ENDINGS = V_ENDINGS;
export const CHILD_ROLES = V_ROLES;
export const STORY_KINDS = ids(V_STORY);
/** Which relationship kinds carry a direction, and so honour `from_id`. */
const DIRECTED = new Set(V_REL.filter(k => k.directed).map(k => k.id));

/**
 * Branch colours are painted straight into a style attribute, so a value like
 * `#fff"><img onerror=…>` would be a stored script rather than a colour.
 * Nothing but a plain hex triple gets in — on write and on import.
 */
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const safeColor = (v, fallback = null) => {
  const c = String(v ?? '').trim();
  return COLOR_RE.test(c) ? c : fallback;
};

/** A coordinate or nothing — never a 0 conjured out of an empty string. */
const coord = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (f in obj) out[f] = obj[f];
  // An empty coordinate lands as NULL, not as the 0/0 in the Gulf of Guinea.
  for (const f of ['birth_lat', 'birth_lon', 'death_lat', 'death_lon', 'lat', 'lon']) {
    if (f in out) out[f] = coord(out[f]);
  }
  return out;
};

const bad = key => { const e = new Error(key); e.status = 400; return e; };
const gone = () => { const e = new Error('err.notfound'); e.status = 404; return e; };

const personExists = id => Boolean(db.prepare('SELECT 1 FROM persons WHERE id=?').get(Number(id)));
const unionExists = id => Boolean(db.prepare('SELECT 1 FROM unions WHERE id=?').get(Number(id)));
export const personById = id => db.prepare('SELECT * FROM persons WHERE id=?').get(Number(id)) || null;

/** Fuzzy text in, derived sort integer alongside — the one place this happens. */
function deriveYears(fields, pairs) {
  for (const [text, year] of pairs) {
    if (text in fields) fields[year] = sortYear(fields[text]);
  }
  return fields;
}

const cleanSex = v => (['m', 'f'].includes(v) ? v : '');
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

// ---------------------------------------------------------------- person fields

/**
 * Write whichever registry fields are in `body`. A shared field lands on row 0
 * and a personal one on the writer's own row, so the same form does the right
 * thing without knowing which is which.
 */
export function writeFields(personId, body, userId) {
  const put = db.prepare(`INSERT INTO person_fields (person_id,user_id,key,value) VALUES (?,?,?,?)
    ON CONFLICT(person_id,user_id,key) DO UPDATE SET value=excluded.value`);
  const drop = db.prepare('DELETE FROM person_fields WHERE person_id=? AND user_id=? AND key=?');
  for (const field of FIELDS) {
    if (!(field.key in body)) continue;
    const owner = field.scope === 'ich' ? Number(userId) || 0 : 0;
    const value = toStored(field, body[field.key]);
    // An emptied personal field means "I have nothing to add", which is not
    // the same as "use the documented record" — but keeping an empty row
    // would hide the record forever, so it goes.
    if (value === '') drop.run(Number(personId), owner, field.key);
    else put.run(Number(personId), owner, field.key, value);
  }
}

export { fieldsByPerson };

// ---------------------------------------------------------------- setup & auth

export function routeSession(ctx) {
  return { needs_setup: needsSetup(), user: ctx.user };
}

/** First boot: exactly one account, and it is the admin. */
export function routeSetup(body) {
  if (!needsSetup()) throw bad('err.setup_done');
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  if (!name || !username) throw bad('err.name_required');
  if (String(body.password || '').length < 8) throw bad('err.password_short');

  return tx(() => {
    const personId = Number(db.prepare('INSERT INTO persons (name) VALUES (?)').run(name).lastInsertRowid);
    const id = createUser({
      username, password: body.password, role: 'admin',
      email: body.email, lang: body.lang, person_id: personId,
    });
    metaSet('created_at', new Date().toISOString());
    return { ok: true, user_id: id, person_id: personId };
  });
}

export function routeLogin(body, res, secure) {
  const out = login(body.username, body.password);
  if (!out) { const e = new Error('err.login_failed'); e.status = 401; throw e; }
  res.setHeader('Set-Cookie', sessionCookie(out.token, secure));
  return { user: out.user };
}

export function routeLogout(token, res) {
  logout(token);
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true };
}

/** Change your own password; every other device is signed out. */
export function routePassword(body, ctx) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.user.id);
  if (!verifyPassword(body.current, u.pass_hash)) throw bad('err.login_failed');
  if (String(body.next || '').length < 8) throw bad('err.password_short');
  db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(body.next), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  return { ok: true };
}

/** Your own account: language, e-mail, linked person — never your role. */
export function routeMe(body, ctx) {
  const patch = {};
  if (body.lang !== undefined) patch.lang = body.lang;
  if (body.email !== undefined) patch.email = body.email;
  if (body.person_id !== undefined) {
    const pid = Number(body.person_id) || null;
    if (pid && !personExists(pid)) throw bad('err.person_missing');
    patch.person_id = pid;
  }
  return friendlyUserWrite(() => updateUser(ctx.user.id, patch));
}

// ---------------------------------------------------------------- accounts

const friendlyUserWrite = fn => {
  try { return fn(); }
  catch (err) {
    if (/UNIQUE/i.test(err.message)) throw bad('err.username_taken');
    throw err;
  }
};

export function routeListUsers() {
  const names = {};
  for (const p of db.prepare('SELECT id,name FROM persons').all()) names[p.id] = p.name;
  return listUsers().map(u => ({ ...u, person_name: names[u.person_id] || null }));
}

export function routeCreateUser(body) {
  const username = String(body.username || '').trim();
  if (!username) throw bad('err.name_required');
  if (String(body.password || '').length < 8) throw bad('err.password_short');

  return tx(() => {
    let personId = body.person_id ? Number(body.person_id) : null;
    if (personId && !personExists(personId)) throw bad('err.person_missing');
    if (!personId && body.person_name) {
      personId = Number(db.prepare('INSERT INTO persons (name) VALUES (?)')
        .run(String(body.person_name).trim()).lastInsertRowid);
    }
    const id = friendlyUserWrite(() => createUser({
      username, password: body.password, role: safeRole(body.role, 'viewer'),
      email: body.email, lang: body.lang, person_id: personId,
    }));
    return { id, person_id: personId };
  });
}

export function routeUpdateUser(id, body, ctx) {
  const target = findUser(id);
  if (!target) throw gone();
  if (body.password !== undefined && String(body.password).length < 8) throw bad('err.password_short');

  const patch = {};
  if (body.username !== undefined) {
    if (!String(body.username).trim()) throw bad('err.name_required');
    patch.username = body.username;
  }
  if (body.role !== undefined && safeRole(body.role) !== target.role) {
    // Your own role is not yours to change, and the last admin cannot fall.
    if (ctx.user.id === Number(id)) throw bad('err.self_demote');
    if (target.role === 'admin' && safeRole(body.role) !== 'admin' && adminCount() <= 1) {
      throw bad('err.last_admin');
    }
    patch.role = body.role;
  }
  if (body.email !== undefined) patch.email = body.email;
  if (body.lang !== undefined) patch.lang = body.lang;
  if (body.password) patch.password = body.password;
  if (body.person_id !== undefined) {
    const pid = Number(body.person_id) || null;
    if (pid && !personExists(pid)) throw bad('err.person_missing');
    patch.person_id = pid;
  }

  const updated = friendlyUserWrite(() => updateUser(id, patch));
  return { ...updated, signed_out: Boolean(patch.password), self: ctx.user.id === Number(id) };
}

export function routeDeleteUser(id, ctx) {
  const target = findUser(id);
  if (!target) throw gone();
  if (ctx.user.id === Number(id)) throw bad('err.self_demote');
  if (target.role === 'admin' && adminCount() <= 1) throw bad('err.last_admin');
  return deleteUser(id);
}

// ---------------------------------------------------------------- invites

export function routeCreateInvite(body, ctx) {
  return createInvite({
    role: safeRole(body.role, 'viewer'),
    invited_name: body.invited_name,
    created_by: ctx.user.id,
  });
}

export const routeListInvites = () => listInvites();
export const routeDeleteInvite = hash => deleteInvite(hash);

export function routeInviteInfo(token) {
  const row = checkInvite(token);
  return row ? { valid: true, role: row.role, invited_name: row.invited_name } : { valid: false };
}

/** Spend the invite and create the account, in one transaction. */
export function routeAcceptInvite(body) {
  const username = String(body.username || '').trim();
  if (!username) throw bad('err.name_required');
  if (String(body.password || '').length < 8) throw bad('err.password_short');

  return tx(() => {
    const invite = consumeInvite(body.token);
    if (!invite) throw bad('err.invite_invalid');
    let personId = null;
    const name = String(body.name || invite.invited_name || '').trim();
    if (name) {
      personId = Number(db.prepare('INSERT INTO persons (name) VALUES (?)').run(name).lastInsertRowid);
    }
    const id = friendlyUserWrite(() => createUser({
      username, password: body.password, role: invite.role,
      email: body.email, lang: body.lang, person_id: personId,
    }));
    return { ok: true, user_id: id, person_id: personId, role: invite.role };
  });
}

// ---------------------------------------------------------------- persons

/**
 * A person arrives with their place in the tree in one request — a phone on a
 * bad line must not create somebody and then fail to connect them. `connect`
 * says where they hang:
 *   {type:'partner',         id: person}          a new union with that person
 *   {type:'child_of_union',  id: union, role}     into an existing union
 *   {type:'child_of_person', id: person, role}    that person's union — theirs
 *                                                 if they have exactly one,
 *                                                 else a new one-parent union
 *   {type:'parent_of',       id: person}          a new union, `id` its child
 * `relate` is the free-form list: [{id, kind, label}].
 */
export function createPerson(body, userId = 0) {
  const fields = deriveYears(pick(body, PERSON_COLS), [['birth', 'birth_year'], ['death', 'death_year']]);
  if (!fields.name || !String(fields.name).trim()) throw bad('err.name_required');
  fields.name = String(fields.name).trim();
  if ('sex' in fields) fields.sex = cleanSex(fields.sex);
  fields.created_by = Number(userId) || null;

  return tx(() => {
    const cols = Object.keys(fields);
    const r = db.prepare(`INSERT INTO persons (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map(c => fields[c]));
    const id = Number(r.lastInsertRowid);
    writeFields(id, body, userId);
    if ('branches' in body) setBranches(id, body.branches);

    if (body.connect && body.connect.type) placeInTree(id, body.connect);
    for (const link of Array.isArray(body.relate) ? body.relate : []) {
      const to = Number(link?.id) || 0;
      if (!to || to === id) continue;
      upsertRelationship({ a_id: id, b_id: to, kind: link.kind, label: link.label });
    }
    return { id };
  });
}

/**
 * Hang `id` into the tree relative to somebody already in it. One set of
 * semantics for both doors — a brand-new person (createPerson's `connect`)
 * and an existing one (`POST /api/persons/:id/connect`) — because "partner
 * of X" must mean the same thing whether X's partner was typed in today or
 * three weeks ago.
 *
 *   {type:'partner',         id: person, kind}     X's family, or a new union
 *   {type:'child_of_union',  id: union, role}      into that very union
 *   {type:'child_of_person', id: person, role}     X's union — theirs if they
 *                                                  have exactly one, else a
 *                                                  new one-parent union
 *   {type:'parent_of',       id: person, kind}     completes X's half-empty
 *                                                  parent union, else new
 *
 * `partner` mirrors `parent_of`'s completion rule: an anchor whose only
 * union still has its second seat free gets the partner seated *there*, so
 * the children already hanging off that union become the couple's children.
 * Always opening a new union is how a grandmother ended up beside her
 * husband with their daughter dangling from him alone — and no form could
 * repair it, because every path made yet another union. Both seats taken,
 * or several unions: a new union is the only honest reading (a remarriage).
 */
export function placeInTree(personId, c) {
  const id = Number(personId);
  const other = Number(c.id) || 0;
  if (c.type === 'partner') {
    if (!personExists(other)) throw bad('err.person_missing');
    if (id === other) throw bad('err.invalid');
    // Already partners somewhere: nothing to add, and no duplicate union.
    const shared = db.prepare(`SELECT a.union_id FROM union_partners a
      JOIN union_partners b ON b.union_id = a.union_id AND b.person_id=?
      WHERE a.person_id=?`).get(other, id);
    if (shared) { if (c.kind) reKind(shared.union_id, c.kind); return; }
    const theirs = db.prepare(`SELECT up.union_id, COUNT(*) partners FROM union_partners up
      WHERE up.union_id IN (SELECT union_id FROM union_partners WHERE person_id=?)
      GROUP BY up.union_id`).all(other);
    if (theirs.length === 1 && theirs[0].partners === 1) {
      addPartner(theirs[0].union_id, id);
      if (c.kind) reKind(theirs[0].union_id, c.kind);
    } else {
      createUnionRow({ partners: [id, other], kind: c.kind });
    }
  } else if (c.type === 'child_of_union') {
    addChild(other, id, c.role);
  } else if (c.type === 'child_of_person') {
    if (!personExists(other)) throw bad('err.person_missing');
    addChild(unionForParent(other), id, c.role);
  } else if (c.type === 'parent_of') {
    if (!personExists(other)) throw bad('err.person_missing');
    // "Add the mother" after the father exists must complete *that*
    // family, not open a parallel one: a child with exactly one parent
    // union that still has a free seat gets the new parent as its second
    // partner. Anything else — no union yet, or both seats taken (a
    // step-parent) — is honestly a new union.
    const seats = db.prepare(`SELECT c.union_id, COUNT(up.person_id) partners
      FROM children c LEFT JOIN union_partners up ON up.union_id = c.union_id
      WHERE c.child_id=? GROUP BY c.union_id`).all(other);
    if (seats.length === 1 && seats[0].partners === 1) {
      addPartner(seats[0].union_id, id);
      if (c.kind) reKind(seats[0].union_id, c.kind);
    } else {
      const unionId = createUnionRow({ partners: [id], kind: c.kind }).id;
      addChild(unionId, other, c.role);
    }
  } else {
    throw bad('err.invalid');
  }
}

/** A stated kind beats the placeholder — and only the placeholder. */
function reKind(unionId, kind) {
  db.prepare("UPDATE unions SET kind=? WHERE id=? AND kind='unbekannt'")
    .run(oneOf(kind, UNION_KINDS, 'unbekannt'), Number(unionId));
}

/** The `POST /api/persons/:id/connect` door: place an existing person. */
export function connectPerson(personId, body) {
  if (!personExists(personId)) throw gone();
  if (!body || !body.type) throw bad('err.invalid');
  return tx(() => { placeInTree(personId, body); return { ok: true }; });
}

/**
 * The union a new child of `personId` goes into: theirs if they have exactly
 * one, else a fresh one-parent union — with a spouse *and* a second marriage
 * there is no honest guess, and a wrong one writes a child onto the wrong
 * marriage.
 */
function unionForParent(personId) {
  const mine = db.prepare('SELECT union_id FROM union_partners WHERE person_id=?').all(Number(personId));
  if (mine.length === 1) return mine[0].union_id;
  return createUnionRow({ partners: [Number(personId)], kind: 'unbekannt' }).id;
}

export function updatePerson(id, body, userId = 0) {
  if (!personExists(id)) throw gone();
  const fields = deriveYears(pick(body, PERSON_COLS), [['birth', 'birth_year'], ['death', 'death_year']]);
  if ('name' in fields) {
    fields.name = String(fields.name).trim();
    if (!fields.name) throw bad('err.name_required');
  }
  if ('sex' in fields) fields.sex = cleanSex(fields.sex);

  return tx(() => {
    const cols = Object.keys(fields);
    if (cols.length) {
      db.prepare(`UPDATE persons SET ${cols.map(c => `${c}=?`).join(',')}, updated_at=datetime('now') WHERE id=?`)
        .run(...cols.map(c => fields[c]), Number(id));
    }
    writeFields(id, body, userId);
    if ('branches' in body) setBranches(id, body.branches);
    return { ok: true };
  });
}

export function deletePerson(id) {
  if (!personExists(id)) throw gone();
  return tx(() => {
    db.prepare('DELETE FROM persons WHERE id=?').run(Number(id));
    sweepEmptyUnions();
    return { ok: true };
  });
}

/** A union with nobody left on either side says nothing — sweep it. */
function sweepEmptyUnions() {
  db.prepare(`DELETE FROM unions WHERE id NOT IN (SELECT union_id FROM union_partners)
    AND id NOT IN (SELECT union_id FROM children)`).run();
}

/**
 * Where people stand within their generation, after somebody dragged one of
 * them: [{id, key}] for the whole row. The layout computes everything else,
 * so this is the one arrangement worth remembering — and clearing it hands
 * that generation back to the automatic tidy pass.
 */
export function saveOrder(body) {
  const rows = Array.isArray(body) ? body : body.order;
  if (!Array.isArray(rows)) throw bad('err.invalid');
  const put = db.prepare('UPDATE persons SET order_key=? WHERE id=?');
  return tx(() => {
    for (const row of rows) {
      const key = Number(row.key);
      put.run(Number.isFinite(key) ? key : null, Number(row.id));
    }
    return { ok: true, saved: rows.length };
  });
}

export function clearOrder() {
  db.prepare('UPDATE persons SET order_key=NULL').run();
  return { ok: true };
}

/** The map's debounced position writes: [{id,x,y}]. Legacy — the tidy layout
 * computes positions now; kept so an older client cannot 404 mid-session. */
export function savePositions(body) {
  const rows = Array.isArray(body) ? body : body.positions;
  if (!Array.isArray(rows)) throw bad('err.invalid');
  const put = db.prepare('UPDATE persons SET x=?, y=? WHERE id=?');
  return tx(() => {
    for (const row of rows) {
      const x = coord(row.x), y = coord(row.y);
      if (x === null || y === null) continue;
      put.run(x, y, Number(row.id));
    }
    return { ok: true, saved: rows.length };
  });
}

// ---------------------------------------------------------------- unions

function createUnionRow({ partners = [], kind, started = '', ended = '', ended_reason = '', note = '' }) {
  const ids = [...new Set(partners.map(Number).filter(Boolean))];
  if (!ids.length) throw bad('err.invalid');
  if (ids.length > 2) throw bad('err.too_many_partners');
  for (const pid of ids) if (!personExists(pid)) throw bad('err.person_missing');
  const r = db.prepare(`INSERT INTO unions (kind,started,started_year,ended,ended_year,ended_reason,note)
    VALUES (?,?,?,?,?,?,?)`)
    .run(oneOf(kind, UNION_KINDS, 'unbekannt'), String(started || ''), sortYear(started),
      String(ended || ''), sortYear(ended), oneOf(ended_reason, UNION_ENDINGS, ''), String(note || ''));
  const id = Number(r.lastInsertRowid);
  const add = db.prepare('INSERT INTO union_partners (union_id,person_id) VALUES (?,?)');
  for (const pid of ids) add.run(id, pid);
  return { id };
}

export const createUnion = body => tx(() => createUnionRow(body));

/** Seat one more partner in a union — the "add the second parent" move. */
export function addPartner(unionId, personId) {
  const uid = Number(unionId), pid = Number(personId);
  if (!unionExists(uid)) throw bad('err.union_missing');
  if (!personExists(pid)) throw bad('err.person_missing');
  const seated = db.prepare('SELECT person_id FROM union_partners WHERE union_id=?').all(uid);
  if (seated.some(r => r.person_id === pid)) return { ok: true };
  if (seated.length >= 2) throw bad('err.too_many_partners');
  if (db.prepare('SELECT 1 FROM children WHERE union_id=? AND child_id=?').get(uid, pid)) {
    throw bad('err.child_is_partner');
  }
  db.prepare('INSERT INTO union_partners (union_id,person_id) VALUES (?,?)').run(uid, pid);
  try {
    assertNoAncestorRing(uid);
  } catch (err) {
    db.prepare('DELETE FROM union_partners WHERE union_id=? AND person_id=?').run(uid, pid);
    throw err;
  }
  return { ok: true };
}

export function updateUnion(id, body) {
  if (!unionExists(id)) throw gone();
  return tx(() => {
    const sets = [], vals = [];
    if ('kind' in body) { sets.push('kind=?'); vals.push(oneOf(body.kind, UNION_KINDS, 'unbekannt')); }
    if ('started' in body) {
      sets.push('started=?', 'started_year=?');
      vals.push(String(body.started || ''), sortYear(body.started));
    }
    if ('ended' in body) {
      sets.push('ended=?', 'ended_year=?');
      vals.push(String(body.ended || ''), sortYear(body.ended));
    }
    if ('ended_reason' in body) {
      sets.push('ended_reason=?');
      vals.push(oneOf(body.ended_reason, UNION_ENDINGS, ''));
    }
    if ('note' in body) { sets.push('note=?'); vals.push(String(body.note || '')); }
    if (sets.length) db.prepare(`UPDATE unions SET ${sets.join(',')} WHERE id=?`).run(...vals, Number(id));

    if (Array.isArray(body.partners)) {
      const ids = [...new Set(body.partners.map(Number).filter(Boolean))];
      if (!ids.length) throw bad('err.invalid');
      if (ids.length > 2) throw bad('err.too_many_partners');
      for (const pid of ids) if (!personExists(pid)) throw bad('err.person_missing');
      const isChild = db.prepare('SELECT 1 FROM children WHERE union_id=? AND child_id=?');
      for (const pid of ids) if (isChild.get(Number(id), pid)) throw bad('err.child_is_partner');
      db.prepare('DELETE FROM union_partners WHERE union_id=?').run(Number(id));
      const add = db.prepare('INSERT INTO union_partners (union_id,person_id) VALUES (?,?)');
      for (const pid of ids) add.run(Number(id), pid);
      assertNoAncestorRing(Number(id));
    }
    return { ok: true };
  });
}

export function deleteUnion(id) {
  if (!unionExists(id)) throw gone();
  db.prepare('DELETE FROM unions WHERE id=?').run(Number(id));
  return { ok: true };
}

/**
 * Hang a child into a union. Refused when the child is a partner of that very
 * union, and when the edge would make somebody their own ancestor — the one
 * shape the whole tree cannot survive, so it is stopped at the door rather
 * than caught in the browser.
 */
export function addChild(unionId, childId, role) {
  const uid = Number(unionId), cid = Number(childId);
  if (!unionExists(uid)) throw bad('err.union_missing');
  if (!personExists(cid)) throw bad('err.person_missing');
  if (db.prepare('SELECT 1 FROM union_partners WHERE union_id=? AND person_id=?').get(uid, cid)) {
    throw bad('err.child_is_partner');
  }
  db.prepare(`INSERT INTO children (union_id,child_id,role) VALUES (?,?,?)
    ON CONFLICT(union_id,child_id) DO UPDATE SET role=excluded.role`)
    .run(uid, cid, oneOf(role, CHILD_ROLES, 'leiblich'));
  try {
    assertNoAncestorRing(uid);
  } catch (err) {
    db.prepare('DELETE FROM children WHERE union_id=? AND child_id=?').run(uid, cid);
    throw err;
  }
  return { ok: true };
}

/** Walk up from each partner of the union; meeting one of its children is a ring. */
function assertNoAncestorRing(unionId) {
  const kids = db.prepare('SELECT child_id FROM children WHERE union_id=?').all(unionId).map(r => r.child_id);
  if (!kids.length) return;
  const parentsOf = db.prepare(`SELECT up.person_id AS pid FROM children c
    JOIN union_partners up ON up.union_id = c.union_id WHERE c.child_id=?`);
  const partners = db.prepare('SELECT person_id FROM union_partners WHERE union_id=?').all(unionId).map(r => r.person_id);
  const kidset = new Set(kids);
  const seen = new Set(partners);
  const queue = [...partners];
  while (queue.length) {
    const cur = queue.shift();
    if (kidset.has(cur)) throw bad('err.tree_ring');
    for (const { pid } of parentsOf.all(cur)) {
      if (!seen.has(pid)) { seen.add(pid); queue.push(pid); }
    }
  }
}

export function removeChild(unionId, childId) {
  db.prepare('DELETE FROM children WHERE union_id=? AND child_id=?').run(Number(unionId), Number(childId));
  return { ok: true };
}

// ---------------------------------------------------------------- relationships

/**
 * Which end a directed relationship points away from — the guardian, the
 * master, the mentor. Normalised on every write, the way a family degree's
 * elder is: a `from_id` outside the pair is meaningless and dropped, and an
 * undirected kind cannot keep one at all, so changing a kind from Vormund to
 * Freunde can never leave a stale direction behind to be read later.
 */
function directionFor(kind, fromId, a, b) {
  if (!DIRECTED.has(kind)) return null;
  const from = Number(fromId) || 0;
  return from === a || from === b ? from : null;
}

export function upsertRelationship(body) {
  const [a, b] = pair(body.a_id, body.b_id);
  if (!a || !b || a === b) throw bad('err.invalid');
  if (!personExists(a) || !personExists(b)) throw bad('err.person_missing');
  const kind = oneOf(body.kind, REL_KINDS, 'sonstig');
  const label = String(body.label || '').trim().slice(0, 400);
  const from = directionFor(kind, body.from_id, a, b);
  const r = db.prepare(`INSERT INTO relationships (a_id,b_id,kind,label,from_id) VALUES (?,?,?,?,?)
    ON CONFLICT(a_id,b_id) DO UPDATE SET
      kind=excluded.kind, label=excluded.label, from_id=excluded.from_id`)
    .run(a, b, kind, label, from);
  return { id: Number(r.lastInsertRowid) };
}

export function updateRelationship(id, body) {
  const row = db.prepare('SELECT * FROM relationships WHERE id=?').get(Number(id));
  if (!row) throw gone();
  const sets = [], vals = [];
  const kind = 'kind' in body ? oneOf(body.kind, REL_KINDS, 'sonstig') : row.kind;
  if ('kind' in body) { sets.push('kind=?'); vals.push(kind); }
  if ('label' in body) { sets.push('label=?'); vals.push(String(body.label || '').trim().slice(0, 400)); }
  // The direction is re-derived whenever either half of it could have moved,
  // so a kind change alone is enough to clear a direction that no longer means
  // anything.
  if ('from_id' in body || 'kind' in body) {
    sets.push('from_id=?');
    vals.push(directionFor(kind, 'from_id' in body ? body.from_id : row.from_id, row.a_id, row.b_id));
  }
  if (sets.length) db.prepare(`UPDATE relationships SET ${sets.join(',')} WHERE id=?`).run(...vals, Number(id));
  return { ok: true };
}

export function deleteRelationship(id) {
  db.prepare('DELETE FROM relationships WHERE id=?').run(Number(id));
  return { ok: true };
}

export const listRelationships = () => db.prepare('SELECT * FROM relationships').all();

// ---------------------------------------------------------------- branches

/** Walking up must end at a root; passing the child again would be a ring. */
function assertBranchLine(childId, parentId) {
  let at = Number(parentId) || 0;
  for (let guard = 0; at && guard < 50; guard++) {
    if (at === Number(childId)) throw bad('err.branch_ring');
    at = db.prepare('SELECT parent_id FROM branches WHERE id=?').get(at)?.parent_id || 0;
  }
}

export function createBranch(body) {
  const name = String(body.name || '').trim();
  if (!name) throw bad('err.name_required');
  const parent = Number(body.parent_id) || null;
  if (parent && !db.prepare('SELECT 1 FROM branches WHERE id=?').get(parent)) throw gone();
  const r = db.prepare('INSERT INTO branches (name,color,emoji,parent_id,sort) VALUES (?,?,?,?,?)')
    .run(name, safeColor(body.color, BRANCH_PALETTE[0]), String(body.emoji || '').slice(0, 8),
      parent, Number(body.sort) || 0);
  return { id: Number(r.lastInsertRowid) };
}

export function updateBranch(id, body) {
  if (!db.prepare('SELECT 1 FROM branches WHERE id=?').get(Number(id))) throw gone();
  const sets = [], vals = [];
  if ('name' in body) {
    const name = String(body.name || '').trim();
    if (!name) throw bad('err.name_required');
    sets.push('name=?'); vals.push(name);
  }
  if ('color' in body) {
    const color = safeColor(body.color);
    if (!color) throw bad('err.color_invalid');
    sets.push('color=?'); vals.push(color);
  }
  if ('emoji' in body) { sets.push('emoji=?'); vals.push(String(body.emoji || '').slice(0, 8)); }
  if ('sort' in body) { sets.push('sort=?'); vals.push(Number(body.sort) || 0); }
  if ('parent_id' in body) {
    const parent = Number(body.parent_id) || null;
    if (parent) {
      if (!db.prepare('SELECT 1 FROM branches WHERE id=?').get(parent)) throw gone();
      assertBranchLine(id, parent);
    }
    sets.push('parent_id=?'); vals.push(parent);
  }
  if (sets.length) db.prepare(`UPDATE branches SET ${sets.join(',')} WHERE id=?`).run(...vals, Number(id));
  return { ok: true };
}

export function deleteBranch(id) {
  // Children are promoted (parent_id → NULL via FK), members fall out of the
  // branch — never out of the tree.
  db.prepare('DELETE FROM branches WHERE id=?').run(Number(id));
  return { ok: true };
}

/** A saved list replaces what was there — the form has to send all of them. */
export function setBranches(personId, list) {
  if (!Array.isArray(list)) return;
  const known = new Set(db.prepare('SELECT id FROM branches').all().map(b => b.id));
  db.prepare('DELETE FROM person_branches WHERE person_id=?').run(Number(personId));
  const add = db.prepare('INSERT OR IGNORE INTO person_branches (person_id,branch_id) VALUES (?,?)');
  for (const bid of list.map(Number)) if (known.has(bid)) add.run(Number(personId), bid);
}

// ---------------------------------------------------------------- stories

export function createStory(body, userId = 0) {
  const title = String(body.title || '').trim();
  if (!title) throw bad('err.name_required');
  return tx(() => {
    const r = db.prepare(`INSERT INTO stories (title,kind,date,date_year,place,lat,lon,text,created_by)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(title, oneOf(body.kind, STORY_KINDS, 'erlebnis'), String(body.date || ''), sortYear(body.date),
        String(body.place || ''), coord(body.lat), coord(body.lon), String(body.text || ''),
        Number(userId) || null);
    const id = Number(r.lastInsertRowid);
    setStoryPeople(id, body.people);
    return { id };
  });
}

export function updateStory(id, body) {
  if (!db.prepare('SELECT 1 FROM stories WHERE id=?').get(Number(id))) throw gone();
  return tx(() => {
    const sets = [], vals = [];
    if ('title' in body) {
      const title = String(body.title || '').trim();
      if (!title) throw bad('err.name_required');
      sets.push('title=?'); vals.push(title);
    }
    if ('kind' in body) { sets.push('kind=?'); vals.push(oneOf(body.kind, STORY_KINDS, 'erlebnis')); }
    if ('date' in body) {
      sets.push('date=?', 'date_year=?');
      vals.push(String(body.date || ''), sortYear(body.date));
    }
    if ('place' in body) { sets.push('place=?'); vals.push(String(body.place || '')); }
    if ('lat' in body) { sets.push('lat=?'); vals.push(coord(body.lat)); }
    if ('lon' in body) { sets.push('lon=?'); vals.push(coord(body.lon)); }
    if ('text' in body) { sets.push('text=?'); vals.push(String(body.text || '')); }
    if (sets.length) db.prepare(`UPDATE stories SET ${sets.join(',')} WHERE id=?`).run(...vals, Number(id));
    if ('people' in body) setStoryPeople(Number(id), body.people);
    return { ok: true };
  });
}

function setStoryPeople(storyId, list) {
  if (!Array.isArray(list)) return;
  db.prepare('DELETE FROM story_people WHERE story_id=?').run(Number(storyId));
  const add = db.prepare('INSERT OR IGNORE INTO story_people (story_id,person_id) VALUES (?,?)');
  for (const pid of list.map(Number).filter(Boolean)) {
    if (personExists(pid)) add.run(Number(storyId), pid);
  }
}

export function deleteStory(id) {
  db.prepare('DELETE FROM stories WHERE id=?').run(Number(id));
  return { ok: true };
}

/** Newest first; people ride along so the list needs one request. */
export function listStories() {
  const stories = db.prepare(`SELECT * FROM stories
    ORDER BY date_year IS NULL, date_year DESC, date DESC, id DESC LIMIT 1000`).all();
  const people = {};
  for (const r of db.prepare('SELECT * FROM story_people').all()) {
    (people[r.story_id] ||= []).push(r.person_id);
  }
  for (const s of stories) s.people = people[s.id] || [];
  return stories;
}

// ---------------------------------------------------------------- sources

export function createSource(body) {
  const title = String(body.title || '').trim();
  if (!title) throw bad('err.name_required');
  return tx(() => {
    const r = db.prepare('INSERT INTO sources (title,detail,url) VALUES (?,?,?)')
      .run(title, String(body.detail || ''), String(body.url || '').trim());
    const id = Number(r.lastInsertRowid);
    if (body.link) linkSource(id, body.link.type, body.link.id);
    return { id };
  });
}

const SUBJECTS = ['person', 'union', 'story'];

export function linkSource(sourceId, type, subjectId) {
  if (!SUBJECTS.includes(type)) throw bad('err.invalid');
  if (!db.prepare('SELECT 1 FROM sources WHERE id=?').get(Number(sourceId))) throw gone();
  db.prepare('INSERT OR IGNORE INTO source_links (source_id,subject_type,subject_id) VALUES (?,?,?)')
    .run(Number(sourceId), type, Number(subjectId));
  return { ok: true };
}

export function unlinkSource(sourceId, type, subjectId) {
  db.prepare('DELETE FROM source_links WHERE source_id=? AND subject_type=? AND subject_id=?')
    .run(Number(sourceId), String(type), Number(subjectId));
  return { ok: true };
}

export function deleteSource(id) {
  db.prepare('DELETE FROM sources WHERE id=?').run(Number(id));
  return { ok: true };
}

export function listSources(type = null, subjectId = null) {
  if (type && subjectId) {
    return db.prepare(`SELECT s.* FROM sources s JOIN source_links l ON l.source_id = s.id
      WHERE l.subject_type=? AND l.subject_id=? ORDER BY s.id`).all(String(type), Number(subjectId));
  }
  const sources = db.prepare('SELECT * FROM sources ORDER BY id').all();
  const links = {};
  for (const l of db.prepare('SELECT * FROM source_links').all()) {
    (links[l.source_id] ||= []).push({ type: l.subject_type, id: l.subject_id });
  }
  for (const s of sources) s.links = links[s.id] || [];
  return sources;
}

// ---------------------------------------------------------------- export / import

export function exportAll() {
  const dump = t => db.prepare(`SELECT * FROM ${t}`).all();
  return {
    format: 'ancestor-map/1',
    exported_at: new Date().toISOString(),
    // Never users, sessions, invites or token hashes: an export is a file
    // that leaves the machine, and it must not carry anything that logs in.
    persons: dump('persons'),
    person_fields: dump('person_fields'),
    unions: dump('unions'),
    union_partners: dump('union_partners'),
    children: dump('children'),
    relationships: dump('relationships'),
    branches: dump('branches'),
    person_branches: dump('person_branches'),
    stories: dump('stories'),
    story_people: dump('story_people'),
    sources: dump('sources'),
    source_links: dump('source_links'),
  };
}

/**
 * Restore a backup. `replace: true` wipes the family data first — accounts
 * and sessions are never touched, so a restore cannot lock anyone out. It
 * does have to *relink* them: wiping persons nulls users.person_id via the
 * foreign key, so the links are snapshotted first and put back after.
 */
export function importAll(payload, { replace = false } = {}) {
  if (!payload || payload.format !== 'ancestor-map/1') throw bad('err.import_format');
  const tables = ['source_links', 'sources', 'story_people', 'stories', 'relationships',
    'children', 'union_partners', 'unions', 'person_branches', 'person_fields', 'persons', 'branches'];

  return tx(() => {
    const links = db.prepare('SELECT id, person_id FROM users WHERE person_id IS NOT NULL').all();
    if (replace) for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();

    const accounts = new Set(db.prepare('SELECT id FROM users').all().map(u => u.id));
    const ownedBy = v => (accounts.has(Number(v)) ? Number(v) : null);

    // Parents are hung afterwards: a child can come before its parent in the
    // file, and the foreign key is checked the moment the row goes in. A file
    // is also the one way a ring can arrive — the closing edge is dropped.
    insertRows('branches', (payload.branches || []).map(b => ({
      ...b, color: safeColor(b.color, BRANCH_PALETTE[0]), parent_id: null,
    })), { replace });
    const here = new Set(db.prepare('SELECT id FROM branches').all().map(b => b.id));
    const standing = new Map(db.prepare('SELECT id, parent_id FROM branches WHERE parent_id IS NOT NULL')
      .all().map(b => [b.id, b.parent_id]));
    const hung = new Map(standing);
    const hang = db.prepare('UPDATE branches SET parent_id=? WHERE id=?');
    for (const b of payload.branches || []) {
      const id = Number(b.id), up = Number(b.parent_id);
      if (!id || !up || up === id || !here.has(id) || !here.has(up)) continue;
      if (!replace && standing.has(id)) continue;
      let ring = false;
      for (let at = up, guard = 0; at && guard < 50; guard++) {
        if (at === id) { ring = true; break; }
        at = hung.get(at) || 0;
      }
      if (ring) continue;
      hung.set(id, up);
      hang.run(up, id);
    }

    insertRows('persons', (payload.persons || []).map(p => ({
      ...p,
      created_by: ownedBy(p.created_by),
      // The fuzzy text is the truth; the derived integers are recomputed so a
      // hand-edited or foreign file cannot smuggle in a stale sort year.
      birth_year: sortYear(p.birth), death_year: sortYear(p.death),
    })), { replace });
    insertRows('person_fields', payload.person_fields, { replace });
    insertRows('unions', (payload.unions || []).map(u => ({
      ...u, started_year: sortYear(u.started), ended_year: sortYear(u.ended),
    })), { replace });
    insertRows('union_partners', payload.union_partners, { replace });
    insertRows('children', payload.children, { replace });
    insertRows('relationships', payload.relationships, { replace });
    insertRows('person_branches', payload.person_branches, { replace });
    insertRows('stories', (payload.stories || []).map(s => ({
      ...s, created_by: ownedBy(s.created_by), date_year: sortYear(s.date),
    })), { replace });
    insertRows('story_people', payload.story_people, { replace });
    insertRows('sources', payload.sources, { replace });
    insertRows('source_links', payload.source_links, { replace });

    const relink = db.prepare('UPDATE users SET person_id=? WHERE id=? AND person_id IS NULL');
    for (const link of links) {
      if (personExists(link.person_id)) relink.run(link.person_id, link.id);
    }
    return { ok: true, persons: (payload.persons || []).length };
  });
}

// Without `replace` the current data wins and the backup only fills the gaps.
// OR REPLACE would be quietly destructive there: it deletes the colliding row
// first, and with foreign keys on, that cascade takes the person's *current*
// fields, unions and branches with it.
function insertRows(table, rows, { replace = true } = {}) {
  if (!rows || !rows.length) return;
  const or = replace ? 'REPLACE' : 'IGNORE';
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  for (const row of rows) {
    const use = cols.filter(c => c in row);
    if (!use.length) continue;
    db.prepare(`INSERT OR ${or} INTO ${table} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`)
      .run(...use.map(c => row[c] ?? null));
  }
}

// ---------------------------------------------------------------- merge & duplicates

const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Likely duplicates, for the admin page — a GEDCOM import's best friend.
 * Same normalised name, and birth years that don't contradict each other.
 */
export function findDuplicates() {
  const groups = new Map();
  for (const p of db.prepare('SELECT id, name, birth, birth_year FROM persons WHERE archived=0').all()) {
    const key = normName(p.name);
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)).push(p);
  }
  const out = [];
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const years = list.map(p => p.birth_year).filter(y => y != null);
    // Two people of one name born decades apart are a grandfather and his
    // grandson, not a duplicate.
    if (years.length >= 2 && Math.max(...years) - Math.min(...years) > 5) continue;
    out.push(list.map(p => ({ id: p.id, name: p.name, birth: p.birth, birth_year: p.birth_year })));
  }
  return out;
}

/**
 * Fold `drop` into `keep`: every union seat, child edge, relationship,
 * branch, field, story and source link moves over — keep's own rows win a
 * collision — and the account that pointed at `drop` follows. One
 * transaction, and the ancestor-ring guard runs on every union that gained
 * a member, so a merge cannot smuggle in the shape the forms refuse.
 */
export function mergePersons({ keep, drop }) {
  const keepId = Number(keep), dropId = Number(drop);
  if (!keepId || !dropId || keepId === dropId) throw bad('err.invalid');
  if (!personExists(keepId) || !personExists(dropId)) throw bad('err.person_missing');

  return tx(() => {
    db.prepare('UPDATE OR IGNORE union_partners SET person_id=? WHERE person_id=?').run(keepId, dropId);
    db.prepare('UPDATE OR IGNORE children SET child_id=? WHERE child_id=?').run(keepId, dropId);
    // A union where keep would now be partner and child at once is the merge
    // telling us these two were never the same person.
    const clash = db.prepare(`SELECT 1 FROM union_partners up JOIN children c
      ON c.union_id = up.union_id AND c.child_id = up.person_id WHERE up.person_id=?`).get(keepId);
    if (clash) throw bad('err.child_is_partner');

    for (const r of db.prepare('SELECT * FROM relationships WHERE a_id=? OR b_id=?').all(dropId, dropId)) {
      const other = r.a_id === dropId ? r.b_id : r.a_id;
      db.prepare('DELETE FROM relationships WHERE id=?').run(r.id);
      if (other === keepId) continue;
      const [a, b] = pair(keepId, other);
      db.prepare(`INSERT INTO relationships (a_id,b_id,kind,label) VALUES (?,?,?,?)
        ON CONFLICT(a_id,b_id) DO NOTHING`).run(a, b, r.kind, r.label);
    }

    db.prepare('UPDATE OR IGNORE person_branches SET person_id=? WHERE person_id=?').run(keepId, dropId);
    db.prepare('UPDATE OR IGNORE person_fields SET person_id=? WHERE person_id=?').run(keepId, dropId);
    db.prepare('UPDATE OR IGNORE story_people SET person_id=? WHERE person_id=?').run(keepId, dropId);
    db.prepare(`UPDATE OR IGNORE source_links SET subject_id=? WHERE subject_type='person' AND subject_id=?`)
      .run(keepId, dropId);
    // subject_id carries no foreign key, so leftovers from the OR IGNORE
    // above would keep pointing at the deleted person — sweep them by hand.
    db.prepare(`DELETE FROM source_links WHERE subject_type='person' AND subject_id=?`).run(dropId);
    db.prepare('UPDATE users SET person_id=? WHERE person_id=?').run(keepId, dropId);

    // Structural facts fill gaps only — the kept person's answers stand.
    const kept = personById(keepId), gone = personById(dropId);
    const fill = {};
    for (const col of ['sex', 'birth', 'death', 'birth_place', 'death_place',
      'birth_lat', 'birth_lon', 'death_lat', 'death_lon']) {
      if ((kept[col] === '' || kept[col] == null) && gone[col] !== '' && gone[col] != null) fill[col] = gone[col];
    }
    if (Object.keys(fill).length) {
      fill.birth_year = sortYear(fill.birth ?? kept.birth);
      fill.death_year = sortYear(fill.death ?? kept.death);
      const cols = Object.keys(fill);
      db.prepare(`UPDATE persons SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`)
        .run(...cols.map(c => fill[c]), keepId);
    }

    const touched = db.prepare('SELECT union_id FROM union_partners WHERE person_id=?').all(keepId);
    db.prepare('DELETE FROM persons WHERE id=?').run(dropId);
    sweepEmptyUnions();
    for (const { union_id } of touched) {
      if (unionExists(union_id)) assertNoAncestorRing(union_id);
    }
    return { ok: true, kept: keepId };
  });
}

// ---------------------------------------------------------------- upcoming

/**
 * Birthdays of the living within the next `days` — the read an automation
 * (or a future reminders screen) asks for. Kept simple and stable: renaming
 * these keys breaks other machines' configs.
 */
export function upcoming(days = 60) {
  const now = new Date();
  const out = [];
  for (const p of db.prepare(`SELECT id, name, birth FROM persons
    WHERE archived=0 AND death='' AND birth<>''`).all()) {
    const parsed = /^(\d{1,4})-(\d{2})-(\d{2})$/.exec(p.birth);
    if (!parsed) continue;                         // fuzzy birthdays have no day to ring on
    const [, y, m, d] = parsed.map(Number);
    // A Feb-29 birthday rings on Feb 28 in common years — Date would quietly
    // roll it to March 1 instead, which no leapling calls their birthday.
    const isLeap = year => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const ring = year => (m === 2 && d === 29 && !isLeap(year)
      ? new Date(year, 1, 28) : new Date(year, m - 1, d));
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let next = ring(now.getFullYear());
    if (next < today0) next = ring(now.getFullYear() + 1);
    const in_days = Math.round((next - today0) / 864e5);
    if (in_days > days) continue;
    out.push({ person_id: p.id, name: p.name, date: localISOFrom(next), in_days, turns: next.getFullYear() - y });
  }
  return out.sort((a, b) => a.in_days - b.in_days);
}

const localISOFrom = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export { today, kinIndexNow };
