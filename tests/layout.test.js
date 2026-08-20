// The layout rules behind the tree, checked without a browser — map.js
// touches nothing at import time, so it imports under plain node. The
// fixture is the kinship test's family, wired through the real store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, reindex } from '../public/js/store.js';
import {
  indexGenerations, genY, indexYears, zeitY, zeitBase, edgeRoom, labelEarned, ROW,
} from '../public/js/map.js';

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

test('a thread earns its words only near fully drawn', () => {
  fixture();
  const r = S.relationships[0];
  const a = S.personById[12], b = S.personById[21];
  assert.equal(labelEarned(r, a, b, 0.5), false, 'no words when barely zoomed');
  assert.equal(labelEarned(r, a, b, 1.4), true, 'words once the line is all but full');
});
