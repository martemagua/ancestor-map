// Kinship — how the person on the card relates to whoever the tree is
// currently read from. Never stored: it changes with the proband switch, so
// it is computed here from the union graph, on demand.
//
// Two halves:
//   relate()        walks the graph and answers with a structured descriptor
//                   ({type:'cousin', degree:2, removed:1} …)
//   kinshipLabel()  turns the descriptor into words in the current language
//
// The words are *constructed*, not looked up — "Ururgroßmutter", "tataravô"
// and "great-great-grandmother" follow three different grammars, so each
// language gets a small labeler below instead of a dictionary entry per
// possible relative. Only the open-ended fallbacks ("ancestor, 9 generations
// back") come from the lang files.
//
// DOM-free on purpose: the server's kinship endpoint imports it, and
// tests/kinship.test.js runs it under plain node.

import { t, getLang } from './i18n.js';

/**
 * Build the walkable indices once per graph. Accepts the raw table rows the
 * API ships: persons [{id, sex}], unions [{id, kind}],
 * union_partners [{union_id, person_id}], children [{union_id, child_id}].
 */
export function buildKinIndex({ persons = [], unions = [], union_partners = [], children = [] }) {
  const sexOf = new Map(persons.map(p => [p.id, p.sex || null]));
  const unionKind = new Map(unions.map(u => [u.id, u.kind || 'unbekannt']));
  const partnersOfUnion = new Map();
  const unionsOfPerson = new Map();
  for (const { union_id, person_id } of union_partners) {
    push(partnersOfUnion, union_id, person_id);
    push(unionsOfPerson, person_id, union_id);
  }
  const childUnions = new Map();   // child -> [union]
  const childrenOfUnion = new Map();
  for (const { union_id, child_id } of children) {
    push(childUnions, child_id, union_id);
    push(childrenOfUnion, union_id, child_id);
  }
  return { sexOf, unionKind, partnersOfUnion, unionsOfPerson, childUnions, childrenOfUnion };
}

const push = (map, k, v) => { const a = map.get(k); if (a) a.push(v); else map.set(k, [v]); };
const get = (map, k) => map.get(k) || [];

export const parentsOf = (idx, id) =>
  [...new Set(get(idx.childUnions, id).flatMap(u => get(idx.partnersOfUnion, u)))];

export const childrenOf = (idx, id) =>
  [...new Set(get(idx.unionsOfPerson, id).flatMap(u => get(idx.childrenOfUnion, u)))];

export const spousesOf = (idx, id) =>
  [...new Set(get(idx.unionsOfPerson, id).flatMap(u => get(idx.partnersOfUnion, u)))]
    .filter(p => p !== id);

/** Every ancestor (including self at 0) with its minimal generation distance. */
function ancestorDepths(idx, id) {
  const depths = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    const d = depths.get(cur) + 1;
    for (const p of parentsOf(idx, cur)) {
      if (!depths.has(p) || depths.get(p) > d) { depths.set(p, d); queue.push(p); }
    }
  }
  return depths;
}

/**
 * Blood relation a→b, or null. Picks the common-ancestor pair with the
 * smallest total distance (ties: the more balanced one), which handles
 * pedigree collapse by preferring the closest reading.
 */
function relateBlood(idx, a, b) {
  const A = ancestorDepths(idx, a);
  const B = ancestorDepths(idx, b);
  let best = null;
  for (const [c, m] of A) {
    const n = B.get(c);
    if (n === undefined) continue;
    if (!best || m + n < best.m + best.n
      || (m + n === best.m + best.n && Math.max(m, n) < Math.max(best.m, best.n))) {
      best = { m, n };
    }
  }
  if (!best) return null;
  const { m, n } = best;
  if (m === 0 && n === 0) return { type: 'self' };
  if (n === 0) return { type: 'ancestor', g: m };
  if (m === 0) return { type: 'descendant', g: n };
  if (m === 1 && n === 1) {
    const shared = get(idx.childUnions, a).some(u => get(idx.childUnions, b).includes(u));
    return { type: 'sibling', full: shared };
  }
  if (n === 1) return { type: 'uncle', greats: m - 2 };
  if (m === 1) return { type: 'nibling', greats: n - 2 };
  return { type: 'cousin', degree: Math.min(m, n) - 1, removed: Math.abs(m - n) };
}

/** Shortest path length over parent/child/spouse steps, for the fallback. */
function stepsBetween(idx, a, b, cap = 12) {
  if (a === b) return 0;
  const seen = new Set([a]);
  let frontier = [a];
  for (let d = 1; d <= cap; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const nb of [...parentsOf(idx, cur), ...childrenOf(idx, cur), ...spousesOf(idx, cur)]) {
        if (nb === b) return d;
        if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return null;
}

/**
 * The structured relation proband→target. Order matters: a spouse who is also
 * a distant cousin is your spouse first; blood beats every in-law reading.
 */
export function relate(idx, probandId, targetId) {
  if (probandId === targetId) return { type: 'self' };

  const sharedUnion = get(idx.unionsOfPerson, probandId)
    .find(u => get(idx.partnersOfUnion, u).includes(targetId));
  if (sharedUnion !== undefined) return { type: 'spouse', kind: idx.unionKind.get(sharedUnion) };

  const blood = relateBlood(idx, probandId, targetId);
  if (blood) return blood;

  // Target is married to blood of mine…
  for (const s of spousesOf(idx, targetId)) {
    const r = relateBlood(idx, probandId, s);
    if (!r) continue;
    if (r.type === 'descendant' && r.g === 1) return { type: 'child_in_law' };
    if (r.type === 'sibling') return { type: 'sibling_in_law' };
    if (r.type === 'ancestor' && r.g === 1) return { type: 'step_parent' };
    if (r.type === 'uncle') return { type: 'uncle', greats: r.greats, byMarriage: true };
  }
  // …or is blood of whom I married.
  for (const s of spousesOf(idx, probandId)) {
    const r = relateBlood(idx, s, targetId);
    if (!r) continue;
    if (r.type === 'ancestor' && r.g === 1) return { type: 'parent_in_law' };
    if (r.type === 'sibling') return { type: 'sibling_in_law' };
    if (r.type === 'descendant' && r.g === 1) return { type: 'step_child' };
  }

  const n = stepsBetween(idx, probandId, targetId);
  return n === null ? { type: 'none' } : { type: 'related', n };
}

/* ---------------------------------------------------------------- labels */

// pick(sex, male, female, neutral)
const by = (sex, m, f, x) => (sex === 'm' ? m : sex === 'f' ? f : x);

const PT_GRAND = {
  m: ['avô', 'bisavô', 'trisavô', 'tataravô'],
  f: ['avó', 'bisavó', 'trisavó', 'tataravó'],
};
const PT_GRANDCHILD = {
  m: ['neto', 'bisneto', 'trineto', 'tataraneto'],
  f: ['neta', 'bisneta', 'trineta', 'tataraneta'],
};
const EN_ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

const LABELERS = {
  de: {
    ancestor(g, sex, lang) {
      if (g === 1) return by(sex, 'Vater', 'Mutter', 'Elternteil');
      if (g > 8) return t('kin.ancestor_far', { g }, lang);
      // "Urgroßvater", "Ururgroßvater" — only the first Ur is capitalized.
      const ur = g > 2 ? 'Ur' + 'ur'.repeat(g - 3) : '';
      const base = by(sex, 'großvater', 'großmutter', 'großelternteil');
      return ur ? ur + base : base[0].toUpperCase() + base.slice(1);
    },
    descendant(g, sex, lang) {
      if (g === 1) return by(sex, 'Sohn', 'Tochter', 'Kind');
      if (g > 8) return t('kin.descendant_far', { g }, lang);
      const ur = g > 2 ? 'Ur' + 'ur'.repeat(g - 3) : '';
      const base = by(sex, 'enkel', 'enkelin', 'enkelkind');
      return ur ? ur + base : base[0].toUpperCase() + base.slice(1);
    },
    sibling: (full, sex) => (full
      ? by(sex, 'Bruder', 'Schwester', 'Geschwister')
      : by(sex, 'Halbbruder', 'Halbschwester', 'Halbgeschwister')),
    uncle(greats, sex, byMarriage) {
      const base = by(sex, 'onkel', 'tante', 'onkel/tante');
      const word = greats <= 0 ? base
        : greats === 1 ? 'groß' + base
          : 'Ur'.repeat(greats - 1).toLowerCase() + 'groß' + base;
      const cased = word[0].toUpperCase() + word.slice(1);
      return byMarriage ? by(sex, 'angeheirateter ', 'angeheiratete ', 'angeheiratete:r ') + cased : cased;
    },
    nibling(greats, sex) {
      const base = by(sex, 'neffe', 'nichte', 'neffe/nichte');
      const word = greats <= 0 ? base
        : greats === 1 ? 'groß' + base
          : 'Ur'.repeat(greats - 1).toLowerCase() + 'groß' + base;
      return word[0].toUpperCase() + word.slice(1);
    },
    cousin(degree, removed, sex) {
      let s = by(sex, 'Cousin', 'Cousine', 'Cousin:e');
      if (degree > 1) s += ` ${degree}. Grades`;
      if (removed) s += `, ${removed} Generation${removed === 1 ? '' : 'en'} versetzt`;
      return s;
    },
    spouse: (kind, sex) => (kind === 'ehe'
      ? by(sex, 'Ehemann', 'Ehefrau', 'Ehepartner:in')
      : by(sex, 'Partner', 'Partnerin', 'Partner:in')),
    parent_in_law: sex => by(sex, 'Schwiegervater', 'Schwiegermutter', 'Schwiegerelternteil'),
    child_in_law: sex => by(sex, 'Schwiegersohn', 'Schwiegertochter', 'Schwiegerkind'),
    sibling_in_law: sex => by(sex, 'Schwager', 'Schwägerin', 'Schwager/Schwägerin'),
    step_parent: sex => by(sex, 'Stiefvater', 'Stiefmutter', 'Stiefelternteil'),
    step_child: sex => by(sex, 'Stiefsohn', 'Stieftochter', 'Stiefkind'),
  },

  'pt-BR': {
    ancestor(g, sex, lang) {
      if (g === 1) return by(sex, 'pai', 'mãe', 'pai/mãe');
      const stem = i => by(sex, PT_GRAND.m[i], PT_GRAND.f[i], `${PT_GRAND.m[i]}/${PT_GRAND.f[i]}`);
      if (g - 2 < PT_GRAND.m.length) return stem(g - 2);
      return t('kin.ancestor_far', { g }, lang);
    },
    descendant(g, sex, lang) {
      if (g === 1) return by(sex, 'filho', 'filha', 'filho/filha');
      const stem = i => by(sex, PT_GRANDCHILD.m[i], PT_GRANDCHILD.f[i], `${PT_GRANDCHILD.m[i]}/${PT_GRANDCHILD.f[i]}`);
      if (g - 2 < PT_GRANDCHILD.m.length) return stem(g - 2);
      return t('kin.descendant_far', { g }, lang);
    },
    sibling: (full, sex) => (full
      ? by(sex, 'irmão', 'irmã', 'irmão/irmã')
      : by(sex, 'meio-irmão', 'meia-irmã', 'meio-irmão/meia-irmã')),
    uncle(greats, sex, byMarriage, lang) {
      let word;
      if (greats <= 0) word = by(sex, 'tio', 'tia', 'tio/tia');
      else if (greats - 1 < PT_GRAND.m.length) {
        word = by(sex, `tio-${PT_GRAND.m[greats - 1]}`, `tia-${PT_GRAND.f[greats - 1]}`,
          `tio-${PT_GRAND.m[greats - 1]}/tia-${PT_GRAND.f[greats - 1]}`);
      } else return t('kin.ancestor_far', { g: greats + 2 }, lang);
      return byMarriage ? `${word} por afinidade` : word;
    },
    nibling(greats, sex, lang) {
      if (greats <= 0) return by(sex, 'sobrinho', 'sobrinha', 'sobrinho/sobrinha');
      if (greats - 1 < PT_GRANDCHILD.m.length) {
        return by(sex, `sobrinho-${PT_GRANDCHILD.m[greats - 1]}`, `sobrinha-${PT_GRANDCHILD.f[greats - 1]}`,
          `sobrinho-${PT_GRANDCHILD.m[greats - 1]}`);
      }
      return t('kin.descendant_far', { g: greats + 2 }, lang);
    },
    cousin(degree, removed, sex) {
      let s = by(sex, 'primo', 'prima', 'primo/prima');
      if (degree > 1) s += ` de ${degree}º grau`;
      if (removed) s += `, ${removed} geraç${removed === 1 ? 'ão' : 'ões'} de distância`;
      return s;
    },
    spouse: (kind, sex) => (kind === 'ehe'
      ? by(sex, 'marido', 'esposa', 'cônjuge')
      : by(sex, 'companheiro', 'companheira', 'companheiro(a)')),
    parent_in_law: sex => by(sex, 'sogro', 'sogra', 'sogro/sogra'),
    child_in_law: sex => by(sex, 'genro', 'nora', 'genro/nora'),
    sibling_in_law: sex => by(sex, 'cunhado', 'cunhada', 'cunhado/cunhada'),
    step_parent: sex => by(sex, 'padrasto', 'madrasta', 'padrasto/madrasta'),
    step_child: sex => by(sex, 'enteado', 'enteada', 'enteado/enteada'),
  },

  en: {
    ancestor(g, sex, lang) {
      if (g === 1) return by(sex, 'father', 'mother', 'parent');
      if (g > 8) return t('kin.ancestor_far', { g }, lang);
      return 'great-'.repeat(g - 2) + by(sex, 'grandfather', 'grandmother', 'grandparent');
    },
    descendant(g, sex, lang) {
      if (g === 1) return by(sex, 'son', 'daughter', 'child');
      if (g > 8) return t('kin.descendant_far', { g }, lang);
      return 'great-'.repeat(g - 2) + by(sex, 'grandson', 'granddaughter', 'grandchild');
    },
    sibling: (full, sex) => (full
      ? by(sex, 'brother', 'sister', 'sibling')
      : by(sex, 'half-brother', 'half-sister', 'half-sibling')),
    uncle(greats, sex, byMarriage) {
      const word = (greats > 0 ? 'great-'.repeat(greats) : '') + by(sex, 'uncle', 'aunt', 'uncle/aunt');
      return byMarriage ? `${word} by marriage` : word;
    },
    nibling: (greats, sex) =>
      (greats > 0 ? 'great-'.repeat(greats) : '') + by(sex, 'nephew', 'niece', 'nephew/niece'),
    cousin(degree, removed) {
      const ord = EN_ORDINAL[degree - 1] || `${degree}th`;
      let s = `${ord} cousin`;
      if (removed) s += removed === 1 ? ' once removed' : removed === 2 ? ' twice removed' : ` ${removed} times removed`;
      return s;
    },
    spouse: (kind, sex) => (kind === 'ehe'
      ? by(sex, 'husband', 'wife', 'spouse')
      : by(sex, 'partner', 'partner', 'partner')),
    parent_in_law: sex => by(sex, 'father-in-law', 'mother-in-law', 'parent-in-law'),
    child_in_law: sex => by(sex, 'son-in-law', 'daughter-in-law', 'child-in-law'),
    sibling_in_law: sex => by(sex, 'brother-in-law', 'sister-in-law', 'sibling-in-law'),
    step_parent: sex => by(sex, 'stepfather', 'stepmother', 'step-parent'),
    step_child: sex => by(sex, 'stepson', 'stepdaughter', 'stepchild'),
  },
};

/** Words for a relation descriptor, in the target's grammatical gender. */
export function labelFor(rel, sex, lang = getLang()) {
  const L = LABELERS[lang] || LABELERS.en;
  switch (rel.type) {
    case 'self': return t('kin.self', null, lang);
    case 'spouse': return L.spouse(rel.kind, sex);
    case 'ancestor': return L.ancestor(rel.g, sex, lang);
    case 'descendant': return L.descendant(rel.g, sex, lang);
    case 'sibling': return L.sibling(rel.full, sex);
    case 'uncle': return L.uncle(rel.greats, sex, rel.byMarriage || false, lang);
    case 'nibling': return L.nibling(rel.greats, sex, lang);
    case 'cousin': return L.cousin(rel.degree, rel.removed, sex);
    case 'parent_in_law': return L.parent_in_law(sex);
    case 'child_in_law': return L.child_in_law(sex);
    case 'sibling_in_law': return L.sibling_in_law(sex);
    case 'step_parent': return L.step_parent(sex);
    case 'step_child': return L.step_child(sex);
    case 'related': return t('kin.related', { n: rel.n }, lang);
    default: return t('kin.none', null, lang);
  }
}

/** The whole trip: who is `targetId` to `probandId`, in words. */
export function kinshipLabel(idx, probandId, targetId, lang = getLang()) {
  const rel = relate(idx, probandId, targetId);
  return labelFor(rel, idx.sexOf.get(targetId) || null, lang);
}
