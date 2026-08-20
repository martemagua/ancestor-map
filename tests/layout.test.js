// The layout rules behind the tree, checked without a browser — map.js
// touches nothing at import time, so it imports under plain node. The
// fixture is the kinship test's family, wired through the real store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, reindex } from '../public/js/store.js';
import {
  indexGenerations, genY, indexYears, zeitY, zeitBase, edgeRoom, labelEarned, shelfSpan, ROW,
} from '../public/js/map.js';
import { computeLayout, buildCells, reorderRow } from '../public/js/layout.js';

/** The layout's view of the fixture, without a canvas anywhere near it. */
function layoutOf(people) {
  indexGenerations(people);
  return computeLayout(people, {
    unions: S.unions,
    partnersOf: uid => S.partnersOfUnion[uid] || [],
    childrenOf: uid => S.childrenOfUnion[uid] || [],
    unionsOf: id => S.unionsOfPerson[id] || [],
    parentUnionsOf: id => S.parentUnionsOf[id] || [],
    yOf: p => genY(p._gen),
  });
}

//   Friedrich(1,*1858) ⚭ Berta(2) ── Wilhelm(3,*1885), Gustav(17)
//   Wilhelm(3) ⚭ Klara(4) ───────── Otto(6,*1920), Erna(7)
//   Otto(6) ⚭ Ana(10) ───────────── Karl(12,*1949)
//   Karl(12) + Duda(15,*1952) ───── Tim(16,*1980)
//   Zé(21) — only a described relationship to Karl
function fixture() {
  Object.assign(S, {
    persons: [
      { id: 1, name: 'Friedrich', birth_year: 1858 }, { id: 2, name: 'Berta', birth_year: null },
      { id: 3, name: 'Wilhelm', birth_year: 1885 }, { id: 4, name: 'Klara', birth_year: null },
      { id: 6, name: 'Otto', birth_year: 1920 }, { id: 7, name: 'Erna', birth_year: null },
      { id: 10, name: 'Ana', birth_year: null }, { id: 12, name: 'Karl', birth_year: 1949 },
      { id: 15, name: 'Duda', birth_year: 1952 }, { id: 16, name: 'Tim', birth_year: 1980 },
      { id: 17, name: 'Gustav', birth_year: null, death_year: 1916 },
      { id: 21, name: 'Zé', birth_year: null },
      { id: 22, name: 'Alte Tante', birth_year: null, death_year: 1900 },
    ].map(p => ({ branches: [], archived: 0, ...p })),
    unions: [
      { id: 100, kind: 'ehe' }, { id: 101, kind: 'ehe' },
      { id: 103, kind: 'ehe' }, { id: 105, kind: 'partnerschaft' },
    ],
    union_partners: [
      { union_id: 100, person_id: 1 }, { union_id: 100, person_id: 2 },
      { union_id: 101, person_id: 3 }, { union_id: 101, person_id: 4 },
      { union_id: 103, person_id: 6 }, { union_id: 103, person_id: 10 },
      { union_id: 105, person_id: 12 }, { union_id: 105, person_id: 15 },
    ],
    children: [
      { union_id: 100, child_id: 3 }, { union_id: 100, child_id: 17 },
      { union_id: 101, child_id: 6 }, { union_id: 101, child_id: 7 },
      { union_id: 103, child_id: 12 }, { union_id: 105, child_id: 16 },
    ],
    relationships: [{ id: 900, a_id: 12, b_id: 21, kind: 'freunde', label: 'Austauschfamilie' }],
    branches: [], stories: [], accounts: [], other_views: [],
    mePersonId: 12, probandId: 12,
  });
  reindex();
  return S.persons;
}

test('generations walk out signed from the proband', () => {
  const people = fixture();
  indexGenerations(people);
  const gen = id => S.personById[id]._gen;
  assert.equal(gen(12), 0, 'the proband');
  assert.equal(gen(6), 1, 'father');
  assert.equal(gen(10), 1, 'mother');
  assert.equal(gen(3), 2, 'grandfather');
  assert.equal(gen(1), 3, 'great-grandfather');
  assert.equal(gen(15), 0, 'partner sits level');
  assert.equal(gen(16), -1, 'child sits below');
  assert.equal(gen(7), 1, 'aunt sits with the parents');
  assert.equal(gen(17), 2, 'great-uncle sits with the grandparents');
  assert.equal(gen(21), 0, 'unreached people default to the proband row');
});

test('the proband switch re-reads the rows', () => {
  const people = fixture();
  S.probandId = 3;                       // Wilhelm's tree now
  indexGenerations(people);
  assert.equal(S.personById[3]._gen, 0);
  assert.equal(S.personById[1]._gen, 1, 'his father is one row up');
  assert.equal(S.personById[12]._gen, -2, 'his grandson two rows down');
});

test('ancestors sit above, descendants below', () => {
  assert.ok(genY(1) < 0, 'a parent row is up');
  assert.ok(genY(-1) > 0, 'a child row is down');
  assert.equal(genY(2), -2 * ROW);
  assert.equal(genY(0), 0);
});

test('Zeit mode estimates missing years from the family around them', () => {
  const people = fixture();
  indexGenerations(people);
  indexYears(people);
  const year = id => S.personById[id]._year;
  assert.equal(year(12), 1949, 'a known year stays');
  assert.equal(year(15), 1952);
  // Klara has no year: her husband is 1885, her son 1920 → somewhere between.
  assert.ok(year(4) >= 1880 && year(4) <= 1900, `Klara estimated ${year(4)}`);
  // Berta: husband 1858, son 1885−28 → close to 1858.
  assert.ok(year(2) >= 1850 && year(2) <= 1870, `Berta estimated ${year(2)}`);
  // Gustav is undated but has parents — the family estimate wins, and it
  // lands him plausibly (born mid-1880s, fell 1916).
  assert.ok(year(17) >= 1880 && year(17) <= 1896, `Gustav estimated ${year(17)}`);
  // Someone with no family at all and only a death year gets the fallback.
  assert.equal(year(22), 1900 - 40);
  // Zé is connected to nobody by blood — no year at all.
  assert.equal(year(21), null);
});

test('the Zeit baseline anchors on the proband and years map to Y', () => {
  const people = fixture();
  indexGenerations(people);
  indexYears(people);
  const base = zeitBase(people);
  assert.equal(base, 1949, "the proband's year");
  assert.ok(zeitY(1885, base) < 0, 'older is up');
  assert.ok(zeitY(1980, base) > 0, 'younger is down');
  assert.equal(zeitY(base, base), 0);
});

test('described threads are earned: zoomed out they fade, zoomed in they show', () => {
  fixture();
  const r = S.relationships[0];
  const a = S.personById[12], b = S.personById[21];
  assert.equal(edgeRoom(r, a, b, 1.4), 1, 'zoomed in, fully there');
  // A labeled thread on the proband keeps some presence even far out…
  assert.ok(edgeRoom(r, a, b, 0.3) < 0.6, 'zoomed way out, mostly faded');
  // …a plain thread between two side characters is simply gone.
  const plain = { kind: 'freunde', label: '' };
  assert.equal(edgeRoom(plain, S.personById[15], b, 0.3), 0, 'a plain far thread vanishes');
  assert.equal(edgeRoom(plain, S.personById[15], b, 0.3, true), 1, 'unless everything is asked for');
  // Both ends inside one drawn blob: the blob already said it.
  a._huddles = ['1:0']; b._huddles = ['1:0'];
  assert.ok(edgeRoom(r, a, b, 1.0) < edgeRoom({ ...r }, { ...a, _huddles: null }, { ...b, _huddles: null }, 1.0));
  a._huddles = null; b._huddles = null;
});

test('a couple is one block, so nobody can stand between them', () => {
  const people = fixture();
  const cells = (() => { indexGenerations(people); return buildCells(people, {
    partnersOf: uid => S.partnersOfUnion[uid] || [],
    childrenOf: uid => S.childrenOfUnion[uid] || [],
    unions: S.unions,
  }); })();
  const couple = cells.find(c => c.people.length === 2 && c.union === 103);
  assert.ok(couple, 'Otto and Ana are one cell');
  assert.deepEqual(couple.people.map(p => p.id).sort((a, b) => a - b), [6, 10]);
  // Everyone is seated exactly once.
  assert.equal(cells.reduce((n, c) => n + c.people.length, 0), people.length);
});

test('spouses end up adjacent and nobody else lands between them', () => {
  const people = fixture();
  const out = layoutOf(people);
  const gap = (a, b) => Math.abs(out.people.get(a).x - out.people.get(b).x);
  for (const [a, b] of [[1, 2], [3, 4], [6, 10], [12, 15]]) {
    const between = people.filter(p => ![a, b].includes(p.id) && p._gen === S.personById[a]._gen
      && out.people.get(p.id).x > Math.min(out.people.get(a).x, out.people.get(b).x)
      && out.people.get(p.id).x < Math.max(out.people.get(a).x, out.people.get(b).x));
    assert.deepEqual(between.map(p => p.name), [], `someone stands between ${a} and ${b}`);
    assert.ok(gap(a, b) < 120, `couple ${a}/${b} sits ${gap(a, b)} apart`);
  }
});

test('nobody overlaps anybody, and children hang under their own union', () => {
  const people = fixture();
  const out = layoutOf(people);
  const byRow = new Map();
  for (const p of people) {
    const seat = out.people.get(p.id);
    if (!byRow.has(seat.y)) byRow.set(seat.y, []);
    byRow.get(seat.y).push(seat.x);
  }
  for (const [y, xs] of byRow) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      assert.ok(xs[i] - xs[i - 1] >= 40, `two people overlap in row ${y}`);
    }
  }
  // Otto and Ana's only child sits under the middle of their bar.
  const union = out.unions.find(u => u.id === 103);
  const karl = out.people.get(12);
  assert.ok(Math.abs(union.x - karl.x) < 30, 'the child is centred under its parents');
});

test('the arrangement settles — no descent line is left with a kink in it', () => {
  // The placement passes shrink their step, so the layout stops somewhere
  // definite. Under a constant step the rows go on nudging each other apart
  // for hundreds of passes and the chart is really just a picture of where
  // the loop was cut off — which shows up here as anchors drifting off the
  // middle of their children.
  const people = fixture();
  const out = layoutOf(people);
  for (const u of out.unions) {
    if (!u.kids.length) continue;
    const middle = u.kids.reduce((s, id) => s + out.people.get(id).x, 0) / u.kids.length;
    assert.ok(Math.abs(u.x - middle) < 30,
      `union ${u.id} leaves its line ${Math.round(Math.abs(u.x - middle))} off its children`);
  }
});

test('a hand-arranged row keeps the order it was given', () => {
  const people = fixture();
  // Somebody dragged the grandparents' row into a deliberate order.
  S.personById[3].order_key = 1;
  S.personById[4].order_key = 0;
  const out = layoutOf(people);
  assert.ok(out.people.get(4).x < out.people.get(3).x, 'the manual order stands');
  S.personById[3].order_key = null;
  S.personById[4].order_key = null;
});

test('dropping someone renumbers their row in the order it now reads', () => {
  const people = fixture();
  const out = layoutOf(people);
  const row = out.cells.filter(c => c.gen === 1);
  const moved = row.find(c => c.people.some(p => p.id === 7));
  assert.ok(moved, 'Erna sits in the parents row');
  const keys = reorderRow(row, 7, -9999);          // dragged to the far left
  assert.ok(keys.length, 'the whole row is renumbered');
  const ernaKey = keys.find(k => k.id === 7).key;
  assert.equal(ernaKey, 0, 'she is now first');
  // Every person in the row got their own whole number, so a key can order
  // two spouses inside their block as well as the blocks against each other.
  const seats = row.reduce((n, c) => n + c.people.length, 0);
  assert.equal(new Set(keys.map(k => k.key)).size, seats);
  assert.deepEqual(keys.map(k => k.key), keys.map((_, i) => i));
});

test('dragging one spouse past the other swaps their sides', () => {
  const people = fixture();
  const out = layoutOf(people);
  const row = out.cells.filter(c => c.gen === 1);
  const couple = row.find(c => c.union === 103);
  const [left, right] = couple.people.map(p => p.id);
  const keys = reorderRow(row, right, couple.x - 500);   // dragged left of them
  const key = id => keys.find(k => k.id === id).key;
  assert.ok(key(right) < key(left), 'the dragged spouse now stands left');
  assert.equal(Math.abs(key(right) - key(left)), 1, 'and they are still neighbours');
});

test('a family stands together — no outsider inside a sibling group', () => {
  const people = fixture();
  const out = layoutOf(people);
  for (const u of out.unions) {
    if (u.kids.length < 2) continue;
    const xs = u.kids.map(id => out.people.get(id).x);
    const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
    // A child's own spouse standing among the siblings is how every chart in
    // the world looks. Anybody else there is a family split in two.
    const inlaws = new Set(u.kids.flatMap(id => (S.unionsOfPerson[id] || [])
      .flatMap(uid => S.partnersOfUnion[uid] || [])));
    const strangers = people.filter(p => !u.kids.includes(p.id) && !inlaws.has(p.id)
      && p._gen === S.personById[u.kids[0]]._gen
      && out.people.get(p.id).x > lo && out.people.get(p.id).x < hi);
    assert.deepEqual(strangers.map(p => p.name), [],
      `union ${u.id}'s children have somebody standing among them`);
  }
});

test('two sibling bars side by side get different heights', () => {
  // Two brothers, each with two children: their sibling bars land in the
  // same band, right next to each other. Drawn at one height they are a
  // single long line, and nothing then says whose children are whose.
  const gens = { 1: 2, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, 10: 0 };
  const people = Object.keys(gens).map(id => ({
    id: +id, name: `P${id}`, _gen: gens[id], branches: [], archived: 0,
  }));
  const unions = [{ id: 1, kind: 'ehe' }, { id: 2, kind: 'ehe' }, { id: 3, kind: 'ehe' }];
  const partners = { 1: [1, 2], 2: [3, 5], 3: [4, 6] };
  const kids = { 1: [3, 4], 2: [7, 8], 3: [9, 10] };
  const out = computeLayout(people, {
    unions,
    partnersOf: uid => partners[uid] || [],
    childrenOf: uid => kids[uid] || [],
    unionsOf: id => Object.keys(partners).filter(u => partners[u].includes(id)).map(Number),
    parentUnionsOf: id => Object.keys(kids).filter(u => kids[u].includes(id)).map(Number),
    yOf: p => genY(p._gen),
  });

  const [a, b] = [2, 3].map(id => out.unions.find(u => u.id === id));
  assert.ok(a.span[0] <= b.span[1] && b.span[0] <= a.span[1], 'the two bars do meet');
  assert.notEqual(a.lane, b.lane, 'so they must not share a height');
  assert.equal(a.lanes, b.lanes, 'and they count the same lanes in their band');
  for (const u of out.unions) assert.ok(u.lane < u.lanes, 'every lane is inside its count');

  // The grandparents' bar is alone in its own band and needs no second lane.
  assert.equal(out.unions.find(u => u.id === 1).lanes, 1);
});

test('the sibling bar always reaches back to its own union', () => {
  // An only child sitting off to the side is the case that broke: the drop
  // from the parents and the drop onto the child are two separate verticals,
  // and without a bar between them the line simply stops in mid-air.
  assert.deepEqual(shelfSpan(100, [160]), [100, 160], 'out to an only child on the right');
  assert.deepEqual(shelfSpan(100, [40]), [40, 100], 'and to one on the left');
  // The ordinary case is unchanged: the anchor already sits over the brood.
  assert.deepEqual(shelfSpan(100, [40, 100, 160]), [40, 160]);
  // A child exactly under the anchor needs no bar at all, and says so.
  const [l, r] = shelfSpan(100, [100]);
  assert.equal(r - l, 0);
});

test('a thread earns its words only near fully drawn', () => {
  fixture();
  const r = S.relationships[0];
  const a = S.personById[12], b = S.personById[21];
  assert.equal(labelEarned(r, a, b, 0.5), false, 'no words when barely zoomed');
  assert.equal(labelEarned(r, a, b, 1.4), true, 'words once the line is all but full');
});
