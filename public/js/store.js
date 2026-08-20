// Shared state, derived indices and the small helpers the whole UI reads.
// The pattern is Friend-Map's: one mutable object, no reactivity — mutate S,
// then call the render function yourself. reindex() rebuilds every derived
// index and clears the memo; nothing else may mutate the graph without it.
import { api } from './api.js';
import { t, getLang } from './i18n.js';
import { FIELDS } from './fields.js';
import {
  REL_KINDS, UNION_KINDS, UNION_ENDINGS, CHILD_ROLES, STORY_KINDS, LIVING,
} from './vocab.js';
import { sortYear, lifespan as lifespanOf } from './fuzzydate.js';
import {
  buildKinIndex, relate, labelFor, parentsOf as kinParents,
  childrenOf as kinChildren, spousesOf as kinSpouses,
} from './kinship.js';

export const S = {
  persons: [], unions: [], union_partners: [], children: [], relationships: [],
  branches: [], stories: [], accounts: [], other_views: [], today: '',
  personById: {}, unionById: {}, branchById: {}, relIndex: {},
  partnersOfUnion: {}, childrenOfUnion: {}, unionsOfPerson: {}, parentUnionsOf: {},
  kinIdx: null,
  user: null, mePersonId: null,
  // Whose tree we are reading. Kinship labels, the layout's generations and
  // the card's relation line all follow it. Until "view from here" is used
  // it stays a *suggestion* (see defaultProband) that follows the data;
  // pinned, it is the reader's choice and nothing overrides it.
  probandId: null, probandPinned: false,
  // 'gen' (generations) | 'zeit' (birth years) — the tree's Y axis.
  layoutMode: 'gen',
  // A branch is normally just shown. Highlighting some dims everyone else
  // without hiding them; switching one off takes it off the map entirely.
  activeBranches: new Set(), litBranches: new Set(), showUnbranched: true,
  openBranches: new Set(),
  search: '',
  // How the people list is arranged — remembered locally, like Friend-Map.
  sortBy: 'name', groupBy: 'branch', quick: new Set(),
};

export const SORTS = [
  { id: 'name', label: () => t('sort.name') },
  { id: 'birth', label: () => t('sort.birth') },
  { id: 'added', label: () => t('sort.added') },
];
export const GROUPS = [
  { id: 'branch', label: () => t('group.branch') },
  { id: 'alpha', label: () => t('group.alpha') },
  { id: 'none', label: () => t('group.none') },
];
export const QUICK = [
  { id: 'pinned', label: () => `★ ${t('quick.pinned')}`, test: p => p.pinned },
  { id: 'nobranch', label: () => t('quick.nobranch'), test: p => !branchesWithParents(p).length },
  { id: 'living', label: () => t('quick.living'), test: p => !p.death },
  { id: 'nodates', label: () => t('quick.nodates'), test: p => !p.birth && !p.death },
];

const VIEW_KEY = 'am-people-view';

export function loadPeopleView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}');
    if (SORTS.some(s => s.id === saved.sortBy)) S.sortBy = saved.sortBy;
    if (GROUPS.some(g => g.id === saved.groupBy)) S.groupBy = saved.groupBy;
    S.quick = new Set((saved.quick || []).filter(q => QUICK.some(x => x.id === q)));
  } catch { /* a broken preference is not worth a broken list */ }
}

export function savePeopleView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      sortBy: S.sortBy, groupBy: S.groupBy, quick: [...S.quick],
    }));
  } catch { /* private mode, whatever */ }
}

// ------------------------------------------------------------------ settings

/** Server settings the UI needs synchronously, filled once at boot. */
export const branchPalette = [];
export const mapCfg = { tileUrl: '' };
export const build = { version: '', commit: '', built_at: null };

export function buildLabel() {
  if (!build.version) return '';
  return `v${build.version} · ${build.commit}`;
}

export async function loadSettings() {
  try {
    const settings = await api.get('/api/settings');
    mapCfg.tileUrl = settings.map?.tile_url || '';
    Object.assign(build, settings.build || {});
    branchPalette.splice(0, branchPalette.length, ...(settings.branch_palette || []));
  } catch { /* the app works without them */ }
}

export const UNGROUPED = '#9A968C';

/**
 * A colour to suggest for a new branch: one nothing else is wearing, at
 * random — choosing is a chore, and two branches in one colour are two blobs
 * on the map you cannot tell apart.
 */
export function suggestBranchColor(avoid = '') {
  if (!branchPalette.length) return UNGROUPED;
  const taken = new Set(S.branches.map(b => String(b.color || '').toUpperCase()));
  taken.add(String(avoid).toUpperCase());
  const free = branchPalette.filter(c => !taken.has(c.toUpperCase()));
  const pool = free.length ? free : branchPalette.filter(c => c.toUpperCase() !== String(avoid).toUpperCase());
  return pool[Math.floor(Math.random() * pool.length)] || branchPalette[0];
}

/**
 * A paler shade for a branch nested inside another: five shades of one green
 * say "these belong together" before a single label is read.
 */
export function lighten(hex, amount = 0.3) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const mix = v => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${mix(parseInt(m[1], 16))}${mix(parseInt(m[2], 16))}${mix(parseInt(m[3], 16))}`;
}

export { REL_KINDS, UNION_KINDS, UNION_ENDINGS, CHILD_ROLES, STORY_KINDS, LIVING };
export const relKind = id => REL_KINDS.find(k => k.id === id) || REL_KINDS[REL_KINDS.length - 1];

/**
 * What a described relationship says on somebody's card. A directed kind
 * reads one way from the end it points away from and the other way from the
 * end it points at — "Vormund von Anna" against "Mündel von Josef".
 */
export function relLabelFor(r, personId) {
  const k = relKind(r.kind);
  if (!k.directed || !r.from_id) return t('rel.' + k.id);
  return t(`rel.${k.id}${Number(r.from_id) === Number(personId) ? '' : '_rev'}`);
}

/**
 * What people in this tree already answered for a field, commonest first.
 *
 * Genealogy notes drift — "Schlosser", "schlosser", "Schlossermeister" — and
 * three spellings of one trade cannot be grouped or counted later. Offering
 * what is already in the tree makes the second entry agree with the first
 * without anybody deciding on a controlled vocabulary up front, and it stays
 * a suggestion: the box is a plain text field and anything can be typed.
 */
export function suggestionsFor(key, limit = 40) {
  const seen = new Map();
  for (const p of S.persons) {
    const raw = String(p[key] ?? '').trim();
    if (!raw) continue;
    const at = seen.get(raw.toLowerCase());
    if (at) at.n += 1;
    else seen.set(raw.toLowerCase(), { value: raw, n: 1 });
  }
  return [...seen.values()]
    .sort((a, b) => b.n - a.n || a.value.localeCompare(b.value, getLang()))
    .slice(0, limit)
    .map(x => x.value);
}

export const storyKind = id => STORY_KINDS.find(k => k.id === id) || STORY_KINDS[STORY_KINDS.length - 1];

// ------------------------------------------------------------------ loading

export async function loadGraph() {
  const g = await api.get('/api/graph');
  Object.assign(S, g);
  reindex();
  return S;
}

export async function loadStories() {
  S.stories = await api.get('/api/stories');
  return S.stories;
}

export function reindex() {
  S.personById = {}; S.unionById = {}; S.branchById = {}; S.relIndex = {};
  S.partnersOfUnion = {}; S.childrenOfUnion = {}; S.unionsOfPerson = {}; S.parentUnionsOf = {};
  for (const p of S.persons) {
    S.personById[p.id] = p;
    if (p.vx === undefined) { p.vx = 0; p.vy = 0; }
  }
  for (const u of S.unions) S.unionById[u.id] = u;
  for (const r of S.union_partners) {
    (S.partnersOfUnion[r.union_id] ||= []).push(r.person_id);
    (S.unionsOfPerson[r.person_id] ||= []).push(r.union_id);
  }
  for (const r of S.children) {
    (S.childrenOfUnion[r.union_id] ||= []).push(r.child_id);
    (S.parentUnionsOf[r.child_id] ||= []).push(r.union_id);
  }
  // Branches start visible, including ones created after the first load.
  const known = (S._knownBranches ||= new Set());
  for (const b of S.branches) {
    S.branchById[b.id] = b;
    if (!known.has(b.id)) { known.add(b.id); S.activeBranches.add(b.id); }
  }
  // A deleted branch must not stay in these — a leftover lit id greys out
  // the whole map with no chip left to switch it off.
  const live = new Set(S.branches.map(b => b.id));
  for (const set of [S.activeBranches, S.litBranches, S.openBranches, known]) {
    for (const id of set) if (!live.has(id)) set.delete(id);
  }
  for (const r of S.relationships) {
    (S.relIndex[r.a_id] ||= []).push(r);
    (S.relIndex[r.b_id] ||= []).push(r);
  }
  S.kinIdx = buildKinIndex({
    persons: S.persons, unions: S.unions,
    union_partners: S.union_partners, children: S.children,
  });
  // Until somebody deliberately picks a centre, keep choosing a sensible
  // one — and re-check it, because "sensible" changes as the tree grows.
  if (!S.probandPinned || !S.personById[S.probandId]) S.probandId = defaultProband();
  memo.clear();
}

/** How much tree hangs off one person — partners, parents and children. */
const familyWeight = id => (S.unionsOfPerson[id] || []).length
  + (S.parentUnionsOf[id] || []).length
  + (S.unionsOfPerson[id] || []).reduce((n, u) => n + (S.childrenOfUnion[u] || []).length, 0);

/**
 * Who the tree centres on when nobody has said: **you**. Opening the app,
 * and stepping back out of somebody else's perspective, both land here, so
 * "your view" is a place you can always get back to rather than a mood the
 * data is in.
 *
 * This used to hand your own person back the moment they hung off nothing,
 * because centring on an island flattened every generation into one row.
 * indexGenerations walks each unattached family on its own now, so an
 * island centre costs nothing — and refusing your own view on a half-typed
 * tree was the worse of the two, since that is exactly when you are looking
 * at it. Somebody else's tree is only chosen when the account has no person
 * of its own at all.
 */
function defaultProband() {
  const me = S.personById[S.mePersonId] ? S.mePersonId : null;
  if (me) return me;
  let best = null, bestWeight = 0;
  for (const p of S.persons) {
    const weight = familyWeight(p.id);
    if (weight > bestWeight) { bestWeight = weight; best = p.id; }
  }
  return best ?? me ?? S.persons[0]?.id ?? null;
}

/**
 * Derived-data memo — everything cached here is a pure function of the graph
 * plus the proband, and the physics asks hundreds of times per frame. The
 * proband is part of the key, so switching it needs no invalidation; every
 * data change funnels through reindex(), which clears the map.
 */
const memo = new Map();
function cached(key, make) {
  const k = S.probandId + ':' + key;
  let v = memo.get(k);
  if (v === undefined) { v = make(); memo.set(k, v); }
  return v;
}

// ------------------------------------------------------------------ family walks

export const proband = () => S.personById[S.probandId] || null;
export const parentsOfP = id => (S.kinIdx ? kinParents(S.kinIdx, id) : []);
export const childrenOfP = id => (S.kinIdx ? kinChildren(S.kinIdx, id) : []);
export const spousesOfP = id => (S.kinIdx ? kinSpouses(S.kinIdx, id) : []);

export function siblingsOfP(id) {
  const out = new Set();
  for (const u of S.parentUnionsOf[id] || []) {
    for (const c of S.childrenOfUnion[u] || []) if (c !== id) out.add(c);
  }
  // Half-siblings share a parent, not a union.
  for (const parent of parentsOfP(id)) {
    for (const u of S.unionsOfPerson[parent] || []) {
      for (const c of S.childrenOfUnion[u] || []) if (c !== id) out.add(c);
    }
  }
  return [...out];
}

export const unionsOfP = id => S.unionsOfPerson[id] || [];
export const unionPartners = uid => S.partnersOfUnion[uid] || [];
export const unionChildren = uid => S.childrenOfUnion[uid] || [];

/** Who this person is to the current proband, in the current language. */
export function kinLabel(personId) {
  if (!S.kinIdx || S.probandId == null || personId == null) return '';
  return cached('kin:' + personId, () => {
    const rel = relate(S.kinIdx, S.probandId, personId);
    if (rel.type === 'none') return '';
    return labelFor(rel, S.kinIdx.sexOf.get(personId) || null, getLang());
  });
}

export const relsOf = id => S.relIndex[id] || [];
export const otherEnd = (rel, id) => S.personById[rel.a_id === id ? rel.b_id : rel.a_id];

// ------------------------------------------------------------------ branches

/**
 * Any list of branches in reading order: parents first, children right
 * behind, with the depth for the indent. Nothing is ever dropped — a ring
 * can only arrive through a hand-edited database, and a walk that quietly
 * returned nothing would take every branch off the map with it.
 */
export function treeOrder(list = S.branches) {
  const here = new Set(list.map(b => b.id));
  const seen = new Set();
  const out = [];
  const add = (b, depth) => {
    if (seen.has(b.id) || depth > 20) return;
    seen.add(b.id);
    out.push({ branch: b, depth });
    for (const child of list.filter(x => x.parent_id === b.id)) add(child, depth + 1);
  };
  for (const b of list) if (!b.parent_id || !here.has(b.parent_id)) add(b, 0);
  for (const b of list) if (!seen.has(b.id)) add(b, 0);
  return out;
}

/**
 * The chip strip as a tree: which branches to draw right now, how deep each
 * sits, and how many sub-branches are folded away under it. Folded is the
 * resting state — the strip says what the map is made of, not every twig.
 */
export function chipTree() {
  const list = treeOrder().map(r => r.branch);
  const byId = new Map(list.map(b => [b.id, b]));
  const rows = [];
  for (const b of list) {
    let depth = 0, shown = true;
    for (let at = b.parent_id, guard = 0; at != null && byId.has(at) && guard < 20; guard++) {
      depth++;
      if (!S.openBranches.has(at)) shown = false;
      at = byId.get(at).parent_id;
    }
    if (shown) rows.push({ branch: b, depth, kids: list.filter(x => x.parent_id === b.id).length });
  }
  return rows;
}

/** A branch's ancestors, innermost first. Ring-guarded like Friend-Map's. */
export function ancestorsOf(branchId) {
  const out = [];
  let at = S.branchById[branchId]?.parent_id || null;
  for (let guard = 0; at && guard < 20; guard++) {
    if (out.includes(at) || !S.branchById[at]) break;
    out.push(at);
    at = S.branchById[at].parent_id || null;
  }
  return out;
}

export const branchChildren = id => S.branches.filter(b => b.parent_id === id);

/** A branch and everything nested inside it — what a chip switches together. */
export function withDescendants(id, out = []) {
  out.push(id);
  for (const child of branchChildren(id)) withDescendants(child.id, out);
  return out;
}

/**
 * Which branches someone counts as being in, once the nesting is followed
 * upward. Membership is only stored on the innermost branch — being in
 * "São Paulo" is being in "Familie Souza" — so every display path reads
 * through here and the parent never has to be written down.
 */
export function branchesWithParents(p) {
  const walk = () => {
    const seen = [];
    for (const bid of (p?.branches || [])) {
      for (const id of [bid, ...ancestorsOf(bid)]) {
        if (S.branchById[id] && !seen.includes(id)) seen.push(id);
      }
    }
    return seen;
  };
  return p?.id == null ? walk() : cached('bwp:' + p.id, walk);
}

/** The stored (innermost) memberships — what the physics pulls on. */
export const branchesOf = p => p?.branches || [];

// ------------------------------------------------------------------ filters

export function passesFilters(p) {
  if (p.archived) return false;
  if (p.id === S.probandId) return true;
  const mine = branchesWithParents(p);
  if (!mine.length) return S.showUnbranched;
  return mine.some(bid => S.activeBranches.has(bid));
}

/**
 * Is this person in the spotlight? With no branch highlighted everyone is.
 * The proband is always lit — a tree makes no sense with its centre greyed.
 */
export function inSpotlight(p) {
  if (!S.litBranches.size) return true;
  return p.id === S.probandId || branchesWithParents(p).some(bid => S.litBranches.has(bid));
}

export function matchesSearch(p) {
  const q = S.search.trim().toLowerCase();
  if (!q) return true;
  const build = () => [
    p.name, p.birth_place, p.death_place, p.birth, p.death,
    ...FIELDS.filter(f => ['text', 'textarea', 'tags', 'url', 'fuzzydate'].includes(f.type))
      .flatMap(f => (f.type === 'tags' ? p[f.key] || [] : [p[f.key]])),
    ...(p.branches || []).map(bid => S.branchById[bid]?.name),
    ...relsOf(p.id).flatMap(r => [r.label, otherEnd(r, p.id)?.name]),
  ].filter(Boolean).join(' ').toLowerCase();
  const hay = p?.id == null ? build() : cached('hay:' + p.id, build);
  return hay.includes(q);
}

/** Everyone the people list should show, in the order it should show them. */
export function peopleList() {
  const active = QUICK.filter(q => S.quick.has(q.id));
  return S.persons
    .filter(p => !p.archived && passesFilters(p) && matchesSearch(p))
    .filter(p => active.every(q => q.test(p)))
    .sort(comparerFor(S.sortBy));
}

const byName = (a, b) => a.name.localeCompare(b.name, getLang());

function comparerFor(sort) {
  switch (sort) {
    case 'birth': return (a, b) => {
      // No birth year sorts last: this sort exists to walk the generations.
      const x = a.birth_year ?? 99999, y = b.birth_year ?? 99999;
      return (x - y) || byName(a, b);
    };
    case 'added': return (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || byName(a, b);
    default: return byName;
  }
}

/** What the other accounts wrote for one field, where it differs. */
export function otherViewsOf(personId, key) {
  return (S.other_views || [])
    .map(view => ({ who: view.name, value: view.fields?.[personId]?.[key] }))
    .filter(line => line.value);
}

// ------------------------------------------------------------------ display

/**
 * The branch colour, or null for the proband (drawn in ink) and for the
 * unbranched — callers supply the --ungrouped token themselves, because a
 * hex here would go stale the moment the theme flips (CLAUDE.md rule).
 */
export function colorOf(p) {
  if (!p || p.id === S.probandId) return null;
  const first = branchesWithParents(p)[0];
  return first ? (S.branchById[first]?.color ?? null) : null;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map(w => [...w][0] || '').join('').toUpperCase() || '?';
}

/** The years line under a name: "1885–1972", "um 1885", "* 1920". */
export const lifespan = p => lifespanOf(p?.birth, p?.death);

/** Today as the calendar on the wall has it — never toISOString(). */
export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export { sortYear };
