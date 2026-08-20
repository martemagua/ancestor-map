// The MCP endpoint, driven the way an agent's client drives it: JSON-RPC
// over POST /mcp, authenticated by an API token, read-only tools.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let S, token;
const ids = {};

const rpc = async (method, params = {}, { auth = true, id = 1 } = {}) => {
  const res = await fetch(`${S.base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: res.status, data: res.status === 202 ? null : await res.json() };
};

before(async () => {
  S = await startServer(4404);
  await S.POST('/api/setup', { name: 'Alex', username: 'alex', password: 'secret-enough' });
  const login = await S.POST('/api/login', { username: 'alex', password: 'secret-enough' });
  ids.me = login.data.user.person_id;

  const w = await S.POST('/api/persons', {
    name: 'Wilhelm Brandt', sex: 'm', birth: '1890-05-02', occupation: 'Schmied',
    connect: { type: 'parent_of', id: ids.me },
  });
  ids.wilhelm = w.data.id;
  await S.POST('/api/stories', {
    title: 'Die Schmiede brennt', kind: 'erlebnis', date: '~1930',
    place: 'Greifswald', text: 'Und Wilhelm baute sie wieder auf.', people: [ids.wilhelm],
  });
  token = (await S.POST('/api/tokens', { name: 'agent' })).data.token;
});
after(() => S.stop());

test('no token, no answers', async () => {
  const out = await rpc('tools/list', {}, { auth: false });
  assert.equal(out.status, 401);
});

test('initialize and tools/list speak MCP', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.data.result.serverInfo.name, 'ancestor-map');
  assert.ok(init.data.result.capabilities.tools);

  const note = await fetch(`${S.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(note.status, 202, 'notifications get 202 and no body');

  const list = await rpc('tools/list');
  const names = list.data.result.tools.map(t => t.name);
  assert.deepEqual(names.sort(), ['family_stats', 'find_person', 'person_facts', 'relationship_between', 'search_stories']);
  assert.ok(list.data.result.tools.every(t => t.inputSchema && t.description));
});

test('find_person answers with the relation to the token owner', async () => {
  const out = await rpc('tools/call', { name: 'find_person', arguments: { query: 'wilh' } });
  const hits = JSON.parse(out.data.result.content[0].text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, ids.wilhelm);
  assert.equal(hits[0].relation_to_you, 'father');
});

test('person_facts carries the documented record and the family around them', async () => {
  const out = await rpc('tools/call', { name: 'person_facts', arguments: { id: ids.wilhelm } });
  const facts = JSON.parse(out.data.result.content[0].text);
  assert.equal(facts.facts.occupation, 'Schmied');
  assert.ok(facts.children.some(c => c.id === ids.me));
  assert.equal(facts.stories.length, 1);
});

test('relationship_between speaks all three languages', async () => {
  const out = await rpc('tools/call', {
    name: 'relationship_between', arguments: { from_id: ids.me, to_id: ids.wilhelm },
  });
  const rel = JSON.parse(out.data.result.content[0].text);
  assert.deepEqual(rel.relation, { type: 'ancestor', g: 1 });
  assert.equal(rel.labels.de, 'Vater');
  assert.equal(rel.labels['pt-BR'], 'pai');
});

test('search_stories finds by text and names the people', async () => {
  const out = await rpc('tools/call', { name: 'search_stories', arguments: { query: 'schmiede' } });
  const stories = JSON.parse(out.data.result.content[0].text);
  assert.equal(stories.length, 1);
  assert.deepEqual(stories[0].people, ['Wilhelm Brandt']);
});

test('unknown tools and methods answer JSON-RPC errors, not crashes', async () => {
  const badTool = await rpc('tools/call', { name: 'drop_tables', arguments: {} });
  assert.equal(badTool.data.error.code, -32602);
  const badMethod = await rpc('resources/list');
  assert.equal(badMethod.data.error.code, -32601);
});
