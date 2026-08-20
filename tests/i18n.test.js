// The contract of the translation layer: every key exists in every language,
// placeholders fill, unknown tags fall back sanely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LANGS, t, tn, setLang, normalizeLang, detectLang } from '../public/js/i18n.js';

test('every key exists in all three languages', () => {
  const all = new Set(LANGS.flatMap(l => Object.keys(DICTS[l])));
  const missing = [];
  for (const key of all) {
    for (const lang of LANGS) {
      if (!(key in DICTS[lang])) missing.push(`${lang}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `keys missing from a language:\n${missing.join('\n')}`);
});

test('no empty translations', () => {
  for (const lang of LANGS) {
    for (const [k, v] of Object.entries(DICTS[lang])) {
      assert.ok(typeof v === 'string' && v.length > 0, `${lang}:${k} is empty`);
    }
  }
});

test('placeholders agree across languages', () => {
  // A {name} used in one language must appear in the others, or a translation
  // silently drops information.
  const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const key of Object.keys(DICTS.en)) {
    const want = holes(DICTS.en[key]);
    for (const lang of ['de', 'pt-BR']) {
      assert.equal(holes(DICTS[lang][key]), want, `${lang}:${key} placeholders differ from en`);
    }
  }
});

test('t() substitutes params and falls back', () => {
  setLang('de');
  assert.equal(t('kin.related', { n: 3 }), 'verwandt (3 Schritte)');
  assert.equal(t('kin.related', { n: 3 }, 'pt-BR'), 'parente (3 passos)');
  assert.equal(t('no.such.key'), 'no.such.key');
  setLang('en');
});

test('normalizeLang and detectLang', () => {
  assert.equal(normalizeLang('pt'), 'pt-BR');
  assert.equal(normalizeLang('pt_BR'), 'pt-BR');
  assert.equal(normalizeLang('PT-br'), 'pt-BR');
  assert.equal(normalizeLang('de-AT'), 'de');
  assert.equal(normalizeLang('en-GB'), 'en');
  assert.equal(normalizeLang('fr'), null);
  assert.equal(detectLang(['fr', 'pt-BR', 'de']), 'pt-BR');
  assert.equal(detectLang(['fr', 'it']), 'en');
  assert.equal(detectLang([]), 'en');
});

test('tn() picks the singular key for 1 and the _plural key otherwise', () => {
  setLang('en');
  assert.equal(tn('kin.related', 1), 'related (1 steps)');
  // No _plural keys exist yet — the fallback is the key itself, visibly.
  assert.equal(tn('kin.related', 2), 'kin.related_plural');
});
