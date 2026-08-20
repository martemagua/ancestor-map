// The vocabularies both sides read, and the promise that every id in them can
// actually be said in all three languages. A kind the form offers, the server
// refuses, or nobody can translate is the kind of bug that only turns up with
// a real family in front of you on a Sunday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REL_KINDS, UNION_KINDS, UNION_ENDINGS, CHILD_ROLES, STORY_KINDS, LIVING, ids,
} from '../public/js/vocab.js';
import * as R from '../server/routes.js';
import { LANGS } from '../public/js/i18n.js';
import de from '../public/js/lang/de.js';
import en from '../public/js/lang/en.js';
import ptBR from '../public/js/lang/pt-BR.js';

const DICTS = { de, en, 'pt-BR': ptBR };

test('the server validates against the very lists the forms offer', () => {
  assert.deepEqual(R.REL_KINDS, ids(REL_KINDS));
  assert.deepEqual(R.UNION_KINDS, ids(UNION_KINDS));
  assert.deepEqual(R.CHILD_ROLES, CHILD_ROLES);
  assert.deepEqual(R.STORY_KINDS, ids(STORY_KINDS));
  assert.deepEqual(R.UNION_ENDINGS, UNION_ENDINGS);
});

test('every vocabulary id can be said in every language', () => {
  const wanted = [
    ...ids(REL_KINDS).map(id => `rel.${id}`),
    ...ids(UNION_KINDS).map(id => `union.${id}`),
    ...UNION_ENDINGS.map(id => `end.${id}`),
    ...CHILD_ROLES.map(id => `role.${id}`),
    ...ids(STORY_KINDS).map(id => `sk.${id}`),
    ...LIVING.map(id => `living.${id}`),
  ];
  for (const lang of LANGS) {
    const missing = wanted.filter(key => !DICTS[lang][key]);
    assert.deepEqual(missing, [], `${lang} cannot say: ${missing.join(', ')}`);
  }
});

test('a directed kind says something different from each end', () => {
  const directed = REL_KINDS.filter(k => k.directed);
  assert.ok(directed.length, 'there are directed kinds to check');
  for (const k of directed) {
    for (const lang of LANGS) {
      const forward = DICTS[lang][`rel.${k.id}`];
      const back = DICTS[lang][`rel.${k.id}_rev`];
      assert.ok(back, `${lang} has no reverse label for ${k.id}`);
      assert.notEqual(forward, back,
        `${lang}'s ${k.id} reads the same from both ends, which defeats the direction`);
    }
  }
});

test('twins are mutual, guardianship is not', () => {
  const kind = id => REL_KINDS.find(k => k.id === id);
  assert.ok(!kind('zwilling').directed, 'being twins is the same fact from both sides');
  assert.ok(!kind('nachbarn').directed);
  assert.ok(kind('vormund').directed, 'a guardian and a ward are not interchangeable');
  assert.ok(kind('lehrherr').directed);
});

test('a union kind never doubles as how it ended', () => {
  // 'geschieden' belongs in the endings, never the kinds — a divorced
  // marriage was still a marriage.
  for (const ending of UNION_ENDINGS.filter(Boolean)) {
    assert.ok(!UNION_KINDS.includes(ending), `${ending} leaked into the union kinds`);
  }
  assert.ok(UNION_ENDINGS.includes(''), 'and "still going" is a valid answer');
});

test('the life events are the ones a timeline can draw', () => {
  const life = STORY_KINDS.filter(k => k.life).map(k => k.id);
  for (const must of ['geburt', 'taufe', 'hochzeit', 'auswanderung', 'militaer', 'tod']) {
    assert.ok(life.includes(must), `${must} should read as a life event`);
  }
  for (const not of ['anekdote', 'erlebnis', 'sonstiges']) {
    assert.ok(!life.includes(not), `${not} is a story, not a life event`);
  }
});
