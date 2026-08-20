// Kinship over a four-generation fixture family, checked in all three
// languages. The fixture (ids in brackets):
//
//   Friedrich(1) ⚭ Berta(2) ──── Wilhelm(3), Gustav(17)
//   Wilhelm(3) ⚭ Klara(4) ────── Otto(6), Erna(7), Rudi(8)
//   Wilhelm(3) + Maria(5) ────── Hugo(9)                    (second union)
//   Otto(6) ⚭ Ana(10) ────────── Karl(12), Ilse(13)
//   Erna(7) ⚭ Paulo(11) ──────── Bia(14)
//   Karl(12) + Duda(15) ──────── Tim(16)
//   Gustav(17) ⚭ Hilde(18) ───── Greta(19)
//   Greta(19), partner unknown ─ Jonas(20)
//   Zé(21) — no union edges at all
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKinIndex, relate, kinshipLabel, parentsOf, childrenOf, spousesOf } from '../public/js/kinship.js';

const persons = [
  [1, 'm'], [2, 'f'], [3, 'm'], [4, 'f'], [5, 'f'], [6, 'm'], [7, 'f'], [8, 'm'],
  [9, 'm'], [10, 'f'], [11, 'm'], [12, 'm'], [13, 'f'], [14, 'f'], [15, 'f'],
  [16, 'm'], [17, 'm'], [18, 'f'], [19, 'f'], [20, 'm'], [21, 'm'],
].map(([id, sex]) => ({ id, sex }));

const unions = [
  { id: 100, kind: 'ehe' }, { id: 101, kind: 'ehe' }, { id: 102, kind: 'partnerschaft' },
  { id: 103, kind: 'ehe' }, { id: 104, kind: 'ehe' }, { id: 105, kind: 'partnerschaft' },
  { id: 106, kind: 'ehe' }, { id: 107, kind: 'unbekannt' },
];

const union_partners = [
  [100, 1], [100, 2], [101, 3], [101, 4], [102, 3], [102, 5], [103, 6], [103, 10],
  [104, 7], [104, 11], [105, 12], [105, 15], [106, 17], [106, 18], [107, 19],
].map(([union_id, person_id]) => ({ union_id, person_id }));

const children = [
  [100, 3], [100, 17], [101, 6], [101, 7], [101, 8], [102, 9],
  [103, 12], [103, 13], [104, 14], [105, 16], [106, 19], [107, 20],
].map(([union_id, child_id]) => ({ union_id, child_id }));

const idx = buildKinIndex({ persons, unions, union_partners, children });

test('graph helpers walk the union model', () => {
  const asc = (a, b) => a - b;
  assert.deepEqual(parentsOf(idx, 12).sort(asc), [6, 10]);
  assert.deepEqual(childrenOf(idx, 3).sort(asc), [6, 7, 8, 9]);
  assert.deepEqual(spousesOf(idx, 3).sort(asc), [4, 5]);
  assert.deepEqual(parentsOf(idx, 20), [19]);   // single known parent
});

test('structured relations', () => {
  assert.deepEqual(relate(idx, 12, 12), { type: 'self' });
  assert.deepEqual(relate(idx, 12, 6), { type: 'ancestor', g: 1 });
  assert.deepEqual(relate(idx, 12, 1), { type: 'ancestor', g: 3 });
  assert.deepEqual(relate(idx, 1, 12), { type: 'descendant', g: 3 });
  assert.deepEqual(relate(idx, 12, 13), { type: 'sibling', full: true });
  assert.deepEqual(relate(idx, 6, 9), { type: 'sibling', full: false });
  assert.deepEqual(relate(idx, 12, 7), { type: 'uncle', greats: 0 });
  assert.deepEqual(relate(idx, 12, 17), { type: 'uncle', greats: 1 });
  assert.deepEqual(relate(idx, 17, 12), { type: 'nibling', greats: 1 });
  assert.deepEqual(relate(idx, 12, 14), { type: 'cousin', degree: 1, removed: 0 });
  assert.deepEqual(relate(idx, 12, 19), { type: 'cousin', degree: 1, removed: 1 });
  assert.deepEqual(relate(idx, 12, 20), { type: 'cousin', degree: 2, removed: 0 });
  assert.deepEqual(relate(idx, 6, 10), { type: 'spouse', kind: 'ehe' });
  assert.deepEqual(relate(idx, 12, 15), { type: 'spouse', kind: 'partnerschaft' });
  assert.deepEqual(relate(idx, 12, 11), { type: 'uncle', greats: 0, byMarriage: true });
  assert.deepEqual(relate(idx, 6, 15), { type: 'child_in_law' });
  assert.deepEqual(relate(idx, 15, 6), { type: 'parent_in_law' });
  assert.deepEqual(relate(idx, 9, 10), { type: 'sibling_in_law' });
  assert.deepEqual(relate(idx, 6, 5), { type: 'step_parent' });
  assert.deepEqual(relate(idx, 4, 9), { type: 'step_child' });
  assert.deepEqual(relate(idx, 12, 21), { type: 'none' });
  assert.equal(relate(idx, 15, 11).type, 'related');
});

const cases = [
  // [proband, target, de, pt-BR, en]
  [12, 6, 'Vater', 'pai', 'father'],
  [12, 10, 'Mutter', 'mãe', 'mother'],
  [12, 3, 'Großvater', 'avô', 'grandfather'],
  [12, 1, 'Urgroßvater', 'bisavô', 'great-grandfather'],
  [12, 2, 'Urgroßmutter', 'bisavó', 'great-grandmother'],
  [16, 1, 'Ururgroßvater', 'trisavô', 'great-great-grandfather'],
  [3, 12, 'Enkel', 'neto', 'grandson'],
  [1, 12, 'Urenkel', 'bisneto', 'great-grandson'],
  [1, 16, 'Ururenkel', 'trineto', 'great-great-grandson'],
  [12, 13, 'Schwester', 'irmã', 'sister'],
  [6, 9, 'Halbbruder', 'meio-irmão', 'half-brother'],
  [12, 7, 'Tante', 'tia', 'aunt'],
  [12, 9, 'Onkel', 'tio', 'uncle'],
  [12, 17, 'Großonkel', 'tio-avô', 'great-uncle'],
  [16, 17, 'Urgroßonkel', 'tio-bisavô', 'great-great-uncle'],
  [17, 12, 'Großneffe', 'sobrinho-neto', 'great-nephew'],
  [12, 11, 'angeheirateter Onkel', 'tio por afinidade', 'uncle by marriage'],
  [12, 14, 'Cousine', 'prima', 'first cousin'],
  [12, 19, 'Cousine, 1 Generation versetzt', 'prima, 1 geração de distância', 'first cousin once removed'],
  [12, 20, 'Cousin 2. Grades', 'primo de 2º grau', 'second cousin'],
  [6, 10, 'Ehefrau', 'esposa', 'wife'],
  [12, 15, 'Partnerin', 'companheira', 'partner'],
  [6, 15, 'Schwiegertochter', 'nora', 'daughter-in-law'],
  [15, 6, 'Schwiegervater', 'sogro', 'father-in-law'],
  [9, 10, 'Schwägerin', 'cunhada', 'sister-in-law'],
  [6, 5, 'Stiefmutter', 'madrasta', 'stepmother'],
  [4, 9, 'Stiefsohn', 'enteado', 'stepson'],
];

for (const [a, b, de, pt, en] of cases) {
  test(`label ${a}→${b}: ${en}`, () => {
    assert.equal(kinshipLabel(idx, a, b, 'de'), de);
    assert.equal(kinshipLabel(idx, a, b, 'pt-BR'), pt);
    assert.equal(kinshipLabel(idx, a, b, 'en'), en);
  });
}

test('fallbacks speak every language', () => {
  assert.equal(kinshipLabel(idx, 12, 12, 'de'), 'das bist du');
  assert.equal(kinshipLabel(idx, 12, 21, 'pt-BR'), 'nenhuma ligação conhecida');
  assert.match(kinshipLabel(idx, 15, 11, 'en'), /related \(\d+ steps\)/);
});

test('deep generations fall back to the generic label', () => {
  // A chain of 10 one-partner unions off Tim(16), far past every word list.
  const P = persons.slice();
  const U = unions.slice();
  const UP = union_partners.slice();
  const C = children.slice();
  let parent = 16;
  for (let i = 0; i < 10; i++) {
    const person = 500 + i, union = 600 + i;
    P.push({ id: person, sex: 'm' });
    U.push({ id: union, kind: 'unbekannt' });
    UP.push({ union_id: union, person_id: parent });
    C.push({ union_id: union, child_id: person });
    parent = person;
  }
  // Tim already sits 4 generations below Friedrich; ten more make 14.
  const deep = buildKinIndex({ persons: P, unions: U, union_partners: UP, children: C });
  assert.equal(kinshipLabel(deep, parent, 1, 'en'), 'ancestor, 14 generations back');
  assert.equal(kinshipLabel(deep, 1, parent, 'de'), 'Nachkomme, 14 Generationen weiter');
  assert.equal(kinshipLabel(deep, parent, 1, 'pt-BR'), 'ancestral, 14 gerações atrás');
});
