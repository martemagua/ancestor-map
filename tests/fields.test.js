// The field registry's storage rules — the subtle ones that bite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, FIELD_KEYS, fieldOf, fieldsIn, isPersonal, SECTIONS,
  toStored, fromStored, isEmpty,
} from '../public/js/fields.js';
import { DICTS } from '../public/js/i18n.js';

test('registry entries are well-formed and labels are real i18n keys', () => {
  const seen = new Set();
  for (const f of FIELDS) {
    assert.ok(f.key && !seen.has(f.key), `duplicate or empty key ${f.key}`);
    seen.add(f.key);
    assert.ok(['gemeinsam', 'ich'].includes(f.scope), `${f.key}: bad scope`);
    assert.ok(['text', 'textarea', 'number', 'bool', 'tags', 'url', 'fuzzydate'].includes(f.type),
      `${f.key}: bad type`);
    assert.ok(f.label in DICTS.en, `${f.key}: label ${f.label} missing from lang files`);
    if (f.placeholder) assert.ok(f.placeholder in DICTS.en, `${f.key}: placeholder key missing`);
    if (f.section !== null) {
      assert.ok(SECTIONS.some(s => s.id === f.section), `${f.key}: unknown section ${f.section}`);
    }
  }
});

test('section labels are i18n keys or empty', () => {
  for (const s of SECTIONS) {
    if (s.label !== '') assert.ok(s.label in DICTS.en, `section ${s.id}: label key missing`);
  }
});

test('helpers answer from the registry', () => {
  assert.ok(FIELD_KEYS.includes('occupation'));
  assert.equal(fieldOf('occupation').scope, 'gemeinsam');
  assert.equal(fieldOf('nope'), null);
  assert.ok(fieldsIn('leben').length >= 3);
  assert.ok(isPersonal('notes'));
  assert.ok(!isPersonal('occupation'));
});

test('an empty number stores as empty text, never 0', () => {
  const num = { type: 'number' };
  assert.equal(toStored(num, ''), '');
  assert.equal(toStored(num, null), '');
  assert.equal(toStored(num, 'abc'), '');
  assert.equal(toStored(num, '7'), '7');
  assert.equal(fromStored(num, ''), null);
  assert.equal(fromStored(num, '7'), 7);
});

test('bools store as 1 or empty', () => {
  const b = { type: 'bool' };
  assert.equal(toStored(b, true), '1');
  assert.equal(toStored(b, false), '');
  assert.equal(fromStored(b, '1'), true);
  assert.equal(fromStored(b, ''), false);
});

test('tags round-trip through one comma field', () => {
  const tags = { type: 'tags' };
  assert.equal(toStored(tags, ' auswanderer , musikerin ,, '), 'auswanderer, musikerin');
  assert.equal(toStored(tags, ['a', ' b ']), 'a, b');
  assert.deepEqual(fromStored(tags, 'a, b'), ['a', 'b']);
  assert.deepEqual(fromStored(tags, ''), []);
});

test('fuzzydate stores trimmed text verbatim', () => {
  const fd = fieldOf('baptism');
  assert.equal(fd.type, 'fuzzydate');
  assert.equal(toStored(fd, ' ~1885 '), '~1885');
  assert.equal(toStored(fd, 'Ostern 1885'), 'Ostern 1885');
  assert.equal(fromStored(fd, '~1885'), '~1885');
});

test('isEmpty knows each type', () => {
  assert.ok(isEmpty({ type: 'tags' }, []));
  assert.ok(!isEmpty({ type: 'tags' }, ['x']));
  assert.ok(isEmpty({ type: 'bool' }, false));
  assert.ok(isEmpty({ type: 'text' }, ''));
  assert.ok(isEmpty({ type: 'number' }, null));
  assert.ok(!isEmpty({ type: 'number' }, 0));
});
