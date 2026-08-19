// The fuzzy-date grammar: what parses, what sorts, what it says in each
// language — and that free text passes through untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFuzzy, isParseable, sortYear, formatFuzzy, lifespan } from '../public/js/fuzzydate.js';
import { setLang } from '../public/js/i18n.js';

test('parses the grammar', () => {
  assert.deepEqual(parseFuzzy('1885'), { kind: 'exact', parts: { y: 1885, m: null, d: null } });
  assert.deepEqual(parseFuzzy('1885-03'), { kind: 'exact', parts: { y: 1885, m: 3, d: null } });
  assert.deepEqual(parseFuzzy('1885-03-14'), { kind: 'exact', parts: { y: 1885, m: 3, d: 14 } });
  assert.deepEqual(parseFuzzy('~1885'), { kind: 'circa', parts: { y: 1885, m: null, d: null } });
  assert.deepEqual(parseFuzzy('<1920'), { kind: 'before', parts: { y: 1920, m: null, d: null } });
  assert.deepEqual(parseFuzzy('>1918'), { kind: 'after', parts: { y: 1918, m: null, d: null } });
  assert.deepEqual(parseFuzzy('1914..1918'),
    { kind: 'range', parts: { y: 1914, m: null, d: null }, parts2: { y: 1918, m: null, d: null } });
  assert.deepEqual(parseFuzzy(' ~ 1885 '), { kind: 'circa', parts: { y: 1885, m: null, d: null } });
  assert.deepEqual(parseFuzzy('812'), { kind: 'exact', parts: { y: 812, m: null, d: null } });
});

test('free text stays free text', () => {
  assert.deepEqual(parseFuzzy('Ostern 1885'), { kind: 'text', raw: 'Ostern 1885' });
  assert.deepEqual(parseFuzzy('1885-13'), { kind: 'text', raw: '1885-13' });   // month 13
  assert.deepEqual(parseFuzzy('1885-03-42'), { kind: 'text', raw: '1885-03-42' });
  assert.deepEqual(parseFuzzy('1918..1914'), { kind: 'text', raw: '1918..1914' }); // backwards range
  assert.equal(parseFuzzy(''), null);
  assert.equal(parseFuzzy('   '), null);
  assert.equal(parseFuzzy(null), null);
  assert.ok(!isParseable('Ostern 1885'));
  assert.ok(!isParseable(''));
  assert.ok(isParseable('~1885'));
});

test('sortYear derives the layout/sort integer', () => {
  assert.equal(sortYear('1885'), 1885);
  assert.equal(sortYear('1885-03-14'), 1885);
  assert.equal(sortYear('~1885'), 1885);
  assert.equal(sortYear('<1920'), 1920);
  assert.equal(sortYear('>1918'), 1918);
  assert.equal(sortYear('1914..1918'), 1916);  // midpoint
  assert.equal(sortYear('1914..1917'), 1915);  // floored
  assert.equal(sortYear('Ostern 1885'), null);
  assert.equal(sortYear(''), null);
});

test('formats in German', () => {
  setLang('de');
  assert.equal(formatFuzzy('1885-03-14'), '14. März 1885');
  assert.equal(formatFuzzy('1885-03'), 'März 1885');
  assert.equal(formatFuzzy('1885'), '1885');
  assert.equal(formatFuzzy('~1885'), 'um 1885');
  assert.equal(formatFuzzy('<1920'), 'vor 1920');
  assert.equal(formatFuzzy('>1918'), 'nach 1918');
  assert.equal(formatFuzzy('1914..1918'), '1914–1918');
  assert.equal(formatFuzzy('Ostern 1885'), 'Ostern 1885');
});

test('formats in Brazilian Portuguese', () => {
  setLang('pt-BR');
  assert.equal(formatFuzzy('1885-03-14'), '14 de março de 1885');
  assert.equal(formatFuzzy('1885-03'), 'março de 1885');
  assert.equal(formatFuzzy('~1885'), 'por volta de 1885');
  assert.equal(formatFuzzy('<1920'), 'antes de 1920');
  assert.equal(formatFuzzy('>1918'), 'depois de 1918');
});

test('formats in English', () => {
  setLang('en');
  assert.equal(formatFuzzy('1885-03-14'), 'March 14, 1885');
  assert.equal(formatFuzzy('1885-03'), 'March 1885');
  assert.equal(formatFuzzy('~1885'), 'circa 1885');
  assert.equal(formatFuzzy('<1920'), 'before 1920');
  assert.equal(formatFuzzy('1914-07..1918-11'), 'July 1914–November 1918');
});

test('lifespan builds the years line', () => {
  setLang('de');
  assert.equal(lifespan('1885-03-14', '1972'), '1885–1972');
  assert.equal(lifespan('~1885', '>1950'), 'um 1885–nach 1950');
  assert.equal(lifespan('1885', ''), '* 1885');
  assert.equal(lifespan('', '1972-01-02'), '† 1972');
  assert.equal(lifespan('', ''), '');
  assert.equal(lifespan('Ostern 1885', ''), '');
  setLang('en');
});
