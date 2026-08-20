// The demo family: an admin can fill a fresh instance from /admin, it lands
// as a real tree, and it refuses the moment anyone real is in there.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let S;
before(async () => {
  S = await startServer(4405);
  await S.POST('/api/setup', { name: 'Alex', username: 'alex', password: 'secret-enough' });
  await S.POST('/api/login', { username: 'alex', password: 'secret-enough' });
});
after(() => S.stop());

test('the account created at setup does not count as a full tree', async () => {
  // Setup makes one person — the admin's own. The demo family still fits.
  const out = await S.POST('/api/demo-family');
  assert.equal(out.status, 200);
  assert.ok(out.data.persons >= 45, `seeded ${out.data.persons} people`);
  assert.ok(out.data.unions >= 14);
  assert.ok(out.data.stories >= 5);
});

test('it lands as a real tree, not a pile of loose people', async () => {
  const graph = (await S.GET('/api/graph')).data;
  const thomas = graph.persons.find(p => p.name === 'Thomas Brandt');
  const ana = graph.persons.find(p => p.name === 'Ana Brandt Souza');
  assert.ok(thomas && ana, 'both sides of the joining marriage exist');

  // The marriage that joins the two lineages, and its children.
  const married = graph.union_partners.filter(r => r.person_id === thomas.id)
    .map(r => r.union_id)
    .find(uid => graph.union_partners.some(r => r.union_id === uid && r.person_id === ana.id));
  assert.ok(married, 'Thomas and Ana share a union');
  assert.ok(graph.children.filter(c => c.union_id === married).length >= 3, 'with children');

  // An adopted child keeps its role, so the dashed elbow has something to draw.
  assert.ok(graph.children.some(c => c.role === 'adoptiert'));
  // Branches, described relationships and coordinates all came along.
  assert.ok(graph.branches.length >= 3);
  assert.ok(graph.relationships.length >= 4);
  assert.ok(graph.persons.some(p => p.birth_lat != null), 'places carry coordinates');

  // Kinship works across the whole depth of the tree: Friedrich stands five
  // generations above Julia — Thomas, Werner, Heinrich, Otto, Friedrich.
  const julia = graph.persons.find(p => p.name === 'Julia Brandt');
  const friedrich = graph.persons.find(p => p.name === 'Friedrich Brandt');
  const kin = (await S.GET(`/api/kinship?from=${julia.id}&to=${friedrich.id}`)).data;
  assert.deepEqual(kin.relation, { type: 'ancestor', g: 5 });
  assert.equal(kin.labels.de, 'Urururgroßvater');
  assert.equal(kin.labels.en, 'great-great-great-grandfather');
});

test('a second run is refused — this never overwrites a real family', async () => {
  const again = await S.POST('/api/demo-family');
  assert.equal(again.status, 400);
  assert.equal(again.data.error, 'err.demo_not_empty');
});

test('only an admin may seed', async () => {
  await S.POST('/api/users', { username: 'edda', password: 'editor-pass1', role: 'editor' });
  S.logoutLocally();
  await S.POST('/api/login', { username: 'edda', password: 'editor-pass1' });
  assert.equal((await S.POST('/api/demo-family')).status, 403);
});
