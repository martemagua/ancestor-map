// All the reads that are more than a plain SELECT: the graph payload, the
// kinship answer, and the stats.
import { db } from './db.js';
import { FIELDS, fieldOf, fromStored } from '../public/js/fields.js';
import { buildKinIndex, relate, labelFor } from '../public/js/kinship.js';

/**
 * Today, where the people using this actually are. `toISOString()` is UTC, and
 * local midnight in Berlin or São Paulo is another day in UTC — a date derived
 * that way is wrong exactly around midnight, which is when it gets noticed.
 */
export const localISO = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => localISO(new Date());

// ---------------------------------------------------------------- person fields

/**
 * Every person's fields as one account sees them: the documented record
 * (user_id 0), with your own rows laid over the top. Two queries, not one per
 * person.
 */
export function fieldsByPerson(userId) {
  const out = {};
  const add = rows => { for (const r of rows) (out[r.person_id] ||= {})[r.key] = r.value; };
  add(db.prepare('SELECT person_id, key, value FROM person_fields WHERE user_id=0').all());
  if (userId) add(db.prepare('SELECT person_id, key, value FROM person_fields WHERE user_id=?').all(Number(userId)));
  return out;
}

/**
 * What the *other* accounts wrote, where it differs from what you see — the
 * footnote on a card. Only personal fields, only differences: a documented
 * value nobody has personalised should appear once.
 */
export function otherViews(userId) {
  const mine = fieldsByPerson(userId);
  const shared = fieldsByPerson(null);
  const others = [];
  const people = db.prepare(`SELECT u.id, COALESCE(p.name, u.username) AS name
    FROM users u LEFT JOIN persons p ON p.id = u.person_id
    WHERE u.id <> ? ORDER BY u.id`).all(Number(userId) || 0);

  for (const who of people) {
    const rows = db.prepare('SELECT person_id, key, value FROM person_fields WHERE user_id=?').all(who.id);
    const byPerson = {};
    for (const r of rows) {
      if (fieldOf(r.key)?.scope !== 'ich') continue;
      const seen = mine[r.person_id]?.[r.key] ?? shared[r.person_id]?.[r.key] ?? '';
      if (r.value && r.value !== seen) (byPerson[r.person_id] ||= {})[r.key] = r.value;
    }
    if (Object.keys(byPerson).length) others.push({ user_id: who.id, name: who.name, fields: byPerson });
  }
  return others;
}

// ---------------------------------------------------------------- the graph

/**
 * The whole tree as one account sees it, in one response: persons with their
 * registry fields flattened back on (so the map, the lists and the search
 * keep reading `p.occupation` without knowing about person_fields), plus the
 * union structure, described relationships, branches and who the accounts are.
 */
export function getGraph(userId = null) {
  const persons = db.prepare('SELECT * FROM persons ORDER BY name COLLATE NOCASE').all();
  const unions = db.prepare('SELECT * FROM unions').all();
  const union_partners = db.prepare('SELECT * FROM union_partners').all();
  const children = db.prepare('SELECT * FROM children').all();
  const relationships = db.prepare('SELECT * FROM relationships').all();
  const branches = db.prepare('SELECT * FROM branches ORDER BY sort, name COLLATE NOCASE').all();
  const accounts = db.prepare(`SELECT u.id AS user_id, u.role, u.person_id, COALESCE(p.name, u.username) AS name
    FROM users u LEFT JOIN persons p ON p.id = u.person_id ORDER BY u.id`).all();

  const rank = {};
  branches.forEach((b, i) => { rank[b.id] = i; });
  const byPerson = {};
  for (const r of db.prepare('SELECT * FROM person_branches').all()) {
    (byPerson[r.person_id] ||= []).push(r.branch_id);
  }
  for (const list of Object.values(byPerson)) list.sort((a, b) => rank[a] - rank[b]);

  const fields = fieldsByPerson(userId);
  for (const p of persons) {
    for (const field of FIELDS) p[field.key] = fromStored(field, fields[p.id]?.[field.key]);
    p.branches = byPerson[p.id] || [];
  }

  return {
    persons, unions, union_partners, children, relationships, branches,
    today: today(),
    // Who the accounts are, so the app can label "R. schreibt: …" without a
    // second endpoint. Names and roles only — nothing /api/users guards.
    accounts,
    // What the others wrote, where it differs — the footnote on a card.
    other_views: userId ? otherViews(userId) : [],
  };
}

// ---------------------------------------------------------------- kinship

/** The kin index over the current database, for the /api/kinship answer. */
export function kinIndexNow() {
  return buildKinIndex({
    persons: db.prepare('SELECT id, sex FROM persons').all(),
    unions: db.prepare('SELECT id, kind FROM unions').all(),
    union_partners: db.prepare('SELECT union_id, person_id FROM union_partners').all(),
    children: db.prepare('SELECT union_id, child_id FROM children').all(),
  });
}

/**
 * Who `to` is to `from`, as a descriptor plus the words in every language —
 * the client shows its own, an automation picks what it needs.
 */
export function kinship(fromId, toId) {
  const idx = kinIndexNow();
  const rel = relate(idx, Number(fromId), Number(toId));
  const sex = idx.sexOf.get(Number(toId)) || null;
  return {
    relation: rel,
    labels: {
      de: labelFor(rel, sex, 'de'),
      'pt-BR': labelFor(rel, sex, 'pt-BR'),
      en: labelFor(rel, sex, 'en'),
    },
  };
}

// ---------------------------------------------------------------- stats

export function stats() {
  const one = sql => db.prepare(sql).get().c;
  const years = db.prepare(`SELECT MIN(birth_year) lo, MAX(birth_year) hi
    FROM persons WHERE birth_year IS NOT NULL`).get();
  return {
    persons: one('SELECT COUNT(*) c FROM persons WHERE archived=0'),
    unions: one('SELECT COUNT(*) c FROM unions'),
    relationships: one('SELECT COUNT(*) c FROM relationships'),
    stories: one('SELECT COUNT(*) c FROM stories'),
    branches: one('SELECT COUNT(*) c FROM branches'),
    sources: one('SELECT COUNT(*) c FROM sources'),
    with_birth_year: one('SELECT COUNT(*) c FROM persons WHERE birth_year IS NOT NULL'),
    earliest_birth_year: years.lo ?? null,
    latest_birth_year: years.hi ?? null,
  };
}
