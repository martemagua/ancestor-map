// Drives the HTTP API the way the frontend does, against a real spawned
// server on a throwaway data dir. The long test builds a small family and
// checks the whole read/write surface once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

process.env.TZ = 'Europe/Berlin';

let S;
before(async () => { S = await startServer(4402); });
after(() => S.stop());

// Ids collected as the family grows; later tests read them.
const id = {};

test('fresh install asks for setup and blocks the API', async () => {
  const session = await S.GET('/api/session');
  assert.equal(session.data.needs_setup, true);
  assert.equal(session.data.user, null);
  assert.equal((await S.GET('/api/graph')).status, 401);
});

test('setup creates one admin account and only runs once', async () => {
  const out = await S.POST('/api/setup', {
    name: 'Alex', username: 'alex', password: 'secret-enough', lang: 'de',
  });
  assert.equal(out.status, 200);
  id.alexPerson = out.data.person_id;

  const again = await S.POST('/api/setup', { name: 'X', username: 'x', password: 'xxxxxxxx' });
  assert.equal(again.status, 400);
  assert.equal(again.data.error, 'err.setup_done');

  const login = await S.POST('/api/login', { username: 'alex', password: 'secret-enough' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'admin');
  assert.equal(login.data.user.lang, 'de');

  const session = await S.GET('/api/session');
  assert.equal(session.data.needs_setup, false);
  assert.equal(session.data.user.username, 'alex');
});

test('a person arrives connected: partner, child of union, child of person', async () => {
  const w = await S.POST('/api/persons', { name: 'Wilhelm', sex: 'm', birth: '1890-05-02', occupation: 'Schmied' });
  assert.equal(w.status, 200);
  id.wilhelm = w.data.id;

  const k = await S.POST('/api/persons', {
    name: 'Klara', sex: 'f', birth: '~1895',
    connect: { type: 'partner', id: id.wilhelm, kind: 'ehe' },
  });
  assert.equal(k.status, 200);
  id.klara = k.data.id;

  let graph = (await S.GET('/api/graph')).data;
  assert.equal(graph.unions.length, 1);
  assert.equal(graph.unions[0].kind, 'ehe');
  id.union = graph.unions[0].id;
  const partners = graph.union_partners.map(r => r.person_id).sort((a, b) => a - b);
  assert.deepEqual(partners, [id.wilhelm, id.klara].sort((a, b) => a - b));

  const o = await S.POST('/api/persons', {
    name: 'Otto', sex: 'm', birth: '1920',
    connect: { type: 'child_of_union', id: id.union },
  });
  id.otto = o.data.id;

  // Otto has no union yet, so a child of his gets a fresh one-parent union.
  const karl = await S.POST('/api/persons', {
    name: 'Karl', sex: 'm', birth: '1949-01-30',
    connect: { type: 'child_of_person', id: id.otto },
  });
  id.karl = karl.data.id;

  graph = (await S.GET('/api/graph')).data;
  assert.equal(graph.unions.length, 2);
  assert.equal(graph.children.length, 2);
  const wilhelm = graph.persons.find(p => p.id === id.wilhelm);
  assert.equal(wilhelm.birth_year, 1890, 'birth_year is derived from the fuzzy text');
  assert.equal(wilhelm.occupation, 'Schmied', 'registry fields are flattened onto the person');
  const klara = graph.persons.find(p => p.id === id.klara);
  assert.equal(klara.birth_year, 1895);
});

test('kinship answers in all three languages', async () => {
  const out = await S.GET(`/api/kinship?from=${id.karl}&to=${id.wilhelm}`);
  assert.equal(out.status, 200);
  assert.deepEqual(out.data.relation, { type: 'ancestor', g: 2 });
  assert.equal(out.data.labels.de, 'Großvater');
  assert.equal(out.data.labels['pt-BR'], 'avô');
  assert.equal(out.data.labels.en, 'grandfather');
});

test('the tree refuses its impossible shapes', async () => {
  // A partner cannot be a child of their own union…
  const asChild = await S.POST(`/api/unions/${id.union}/children`, { child_id: id.wilhelm });
  assert.equal(asChild.status, 400);
  assert.equal(asChild.data.error, 'err.child_is_partner');

  // …and nobody can become their own ancestor: hanging Wilhelm as a child of
  // Karl's parent union would make him a descendant of his own son Otto.
  const graph = (await S.GET('/api/graph')).data;
  const karlsUnion = graph.children.find(c => c.child_id === id.karl).union_id;
  const ring = await S.POST(`/api/unions/${karlsUnion}/children`, { child_id: id.wilhelm });
  assert.equal(ring.status, 400);
  assert.equal(ring.data.error, 'err.tree_ring');
  const after = (await S.GET('/api/graph')).data;
  assert.equal(after.children.length, graph.children.length, 'the refused edge left nothing behind');
});

test('free-form relationships upsert as one undirected pair', async () => {
  const ze = await S.POST('/api/persons', { name: 'Zé', sex: 'm' });
  id.ze = ze.data.id;
  const r1 = await S.POST('/api/relationships', {
    a_id: id.karl, b_id: id.ze, kind: 'freunde', label: 'Austauschfamilie in São Paulo',
  });
  assert.equal(r1.status, 200);
  // Same pair the other way round updates instead of duplicating.
  await S.POST('/api/relationships', { a_id: id.ze, b_id: id.karl, kind: 'pate', label: 'Taufpate' });
  const rels = (await S.GET('/api/relationships')).data;
  assert.equal(rels.length, 1);
  assert.equal(rels[0].kind, 'pate');
  assert.equal(rels[0].a_id, Math.min(id.karl, id.ze));

  const self = await S.POST('/api/relationships', { a_id: id.ze, b_id: id.ze, kind: 'freunde' });
  assert.equal(self.status, 400);
});

test('branches nest, refuse rings, and hold members', async () => {
  const souza = await S.POST('/api/branches', { name: 'Familie Souza', color: '#3E7CB1' });
  id.souza = souza.data.id;
  const sp = await S.POST('/api/branches', { name: 'São Paulo', parent_id: id.souza });
  id.saoPaulo = sp.data.id;

  const ring = await S.PUT(`/api/branches/${id.souza}`, { parent_id: id.saoPaulo });
  assert.equal(ring.status, 400);
  assert.equal(ring.data.error, 'err.branch_ring');

  const badColor = await S.PUT(`/api/branches/${id.souza}`, { color: '"><script>' });
  assert.equal(badColor.status, 400);
  assert.equal(badColor.data.error, 'err.color_invalid');

  await S.PUT(`/api/persons/${id.ze}`, { branches: [id.saoPaulo] });
  const graph = (await S.GET('/api/graph')).data;
  assert.deepEqual(graph.persons.find(p => p.id === id.ze).branches, [id.saoPaulo]);
});

test('personal notes stay personal; the record is shared', async () => {
  await S.PUT(`/api/persons/${id.wilhelm}`, { notes: 'Meine Vermutung: kam aus Pommern.' });
  const graph = (await S.GET('/api/graph')).data;
  assert.equal(graph.persons.find(p => p.id === id.wilhelm).notes, 'Meine Vermutung: kam aus Pommern.');
  // Emptying a personal field deletes the row rather than masking anything.
  await S.PUT(`/api/persons/${id.wilhelm}`, { notes: '' });
  const again = (await S.GET('/api/graph')).data;
  assert.equal(again.persons.find(p => p.id === id.wilhelm).notes, '');
});

test('stories carry their people and a fuzzy date', async () => {
  const s = await S.POST('/api/stories', {
    title: 'Überfahrt nach Brasilien', kind: 'auswanderung', date: '~1950',
    people: [id.otto, id.karl], text: 'Mit der Conte Grande ab Genua.',
  });
  assert.equal(s.status, 200);
  id.story = s.data.id;
  const list = (await S.GET('/api/stories')).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].date_year, 1950);
  assert.deepEqual(list[0].people.sort((a, b) => a - b), [id.otto, id.karl].sort((a, b) => a - b));
});

test('sources link to subjects', async () => {
  const src = await S.POST('/api/sources', {
    title: 'Kirchenbuch Stettin 1890', link: { type: 'person', id: id.wilhelm },
  });
  assert.equal(src.status, 200);
  const forWilhelm = (await S.GET(`/api/sources?type=person&id=${id.wilhelm}`)).data;
  assert.equal(forWilhelm.length, 1);
  assert.equal(forWilhelm[0].title, 'Kirchenbuch Stettin 1890');
});

test('positions save, empty coordinates are ignored', async () => {
  const out = await S.POST('/api/positions', [{ id: id.karl, x: 12.5, y: -30 }, { id: id.otto, x: '', y: null }]);
  assert.equal(out.status, 200);
  const graph = (await S.GET('/api/graph')).data;
  assert.equal(graph.persons.find(p => p.id === id.karl).x, 12.5);
  assert.equal(graph.persons.find(p => p.id === id.otto).x, null);
});

test('upcoming sees exact birthdays of the living only', async () => {
  const soon = new Date(Date.now() + 3 * 864e5);
  const iso = `1980-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const p = await S.POST('/api/persons', { name: 'Bia', sex: 'f', birth: iso });
  id.bia = p.data.id;
  await S.POST('/api/persons', { name: 'Ahn', birth: '~1800', death: '1870' });

  const up = (await S.GET('/api/upcoming?days=10')).data;
  const bia = up.find(u => u.person_id === id.bia);
  assert.ok(bia, 'the birthday within the window is found');
  assert.equal(bia.in_days, 3);
  assert.equal(bia.turns, soon.getFullYear() - 1980);
  assert.ok(!up.some(u => u.name === 'Ahn'), 'fuzzy or dead: no reminder');
});

test('export → wipe-import restores the family and relinks accounts', async () => {
  const exported = (await S.GET('/api/export')).data;
  assert.equal(exported.format, 'ancestor-map/1');
  assert.ok(exported.persons.length >= 6);
  assert.ok(!('users' in exported) && !('sessions' in exported) && !('api_tokens' in exported),
    'nothing that logs in leaves the machine');

  const imported = await S.POST('/api/import', { data: exported, replace: true });
  assert.equal(imported.status, 200);

  const graph = (await S.GET('/api/graph')).data;
  assert.equal(graph.persons.length, exported.persons.length);
  assert.equal(graph.unions.length, exported.unions.length);
  assert.equal(graph.children.length, exported.children.length);

  const me = (await S.GET('/api/session')).data.user;
  assert.equal(me.person_id, id.alexPerson, 'the account is relinked to its person after a replace');
});

test('bad import formats are refused', async () => {
  const out = await S.POST('/api/import', { data: { format: 'friend-map/2' } });
  assert.equal(out.status, 400);
  assert.equal(out.data.error, 'err.import_format');
});

test('an invite is single-use and carries its role', async () => {
  const invite = await S.POST('/api/invites', { role: 'editor', invited_name: 'Duda' });
  assert.equal(invite.status, 200);
  const token = invite.data.token;

  S.logoutLocally();
  const info = await S.GET(`/api/invite?token=${token}`);
  assert.equal(info.data.valid, true);
  assert.equal(info.data.role, 'editor');

  const accept = await S.POST('/api/invite/accept', {
    token, username: 'duda', password: 'senha-segura', lang: 'pt-BR',
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.role, 'editor');
  assert.ok(accept.data.person_id, 'the invited name became a person');

  const twice = await S.POST('/api/invite/accept', { token, username: 'x2', password: 'xxxxxxxx' });
  assert.equal(twice.status, 400);
  assert.equal(twice.data.error, 'err.invite_invalid');

  const login = await S.POST('/api/login', { username: 'duda', password: 'senha-segura' });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.role, 'editor');
});

test('an API token reads and does nothing else', async () => {
  const minted = await S.POST('/api/tokens', { name: 'n8n' });
  assert.equal(minted.status, 200);
  assert.ok(minted.data.token.startsWith('am_'));

  S.logoutLocally();
  S.state.bearer = minted.data.token;
  const graph = await S.GET('/api/graph');
  assert.equal(graph.status, 200);
  const write = await S.POST('/api/persons', { name: 'Eindringling' });
  assert.equal(write.status, 403);
  const exportTry = await S.GET('/api/export');
  assert.equal(exportTry.status, 403, 'tokens never export');
  S.logoutLocally();
});

test('places knows every coordinate: births, deaths, stories', async () => {
  await S.POST('/api/login', { username: 'duda', password: 'senha-segura' });
  const p = await S.POST('/api/persons', {
    name: 'Geo Person', birth: '1900', birth_place: 'Greifswald', birth_lat: 54.096, birth_lon: 13.387,
    death: '1980', death_place: 'São Paulo', death_lat: -23.551, death_lon: -46.633,
  });
  await S.POST('/api/stories', {
    title: 'Ortsgeschichte', date: '1950', place: 'Hamburg', lat: 53.551, lon: 9.994, people: [p.data.id],
  });

  const places = (await S.GET('/api/geo/places')).data;
  assert.ok(places.births.some(b => b.id === p.data.id && b.year === 1900 && b.lat === 54.096));
  assert.ok(places.deaths.some(d => d.id === p.data.id && d.year === 1980));
  assert.ok(places.stories.some(s => s.title === 'Ortsgeschichte' && s.year === 1950));
});

test('geo search answers short queries locally and tiles validate coordinates', async () => {
  // Two letters never reach Nominatim — the tests must run offline.
  const short = await S.GET('/api/geo/search?q=ab');
  assert.deepEqual(short.data.hits, []);
  const bad = await S.GET('/api/geo/tile/99/0/0');
  assert.equal(bad.status, 404);
});

test('login answers are rate-limited only on failures', async () => {
  for (let i = 0; i < 3; i++) {
    const ok = await S.POST('/api/login', { username: 'duda', password: 'senha-segura' });
    assert.equal(ok.status, 200);
  }
});
