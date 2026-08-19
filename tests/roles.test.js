// The authorization model: viewer reads, editor writes the family, admin
// runs the installation — enforced by the server, not the UI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.mjs';

let S;
before(async () => {
  S = await startServer(4403);
  await S.POST('/api/setup', { name: 'Alex', username: 'alex', password: 'secret-enough' });
  await S.POST('/api/login', { username: 'alex', password: 'secret-enough' });
  await S.POST('/api/users', { username: 'viola', password: 'viewer-pass1', role: 'viewer', person_name: 'Viola' });
  await S.POST('/api/users', { username: 'edda', password: 'editor-pass1', role: 'editor' });
  await S.POST('/api/persons', { name: 'Wilhelm', sex: 'm' });
});
after(() => S.stop());

test('a viewer reads everything and writes nothing', async () => {
  S.logoutLocally();
  await S.POST('/api/login', { username: 'viola', password: 'viewer-pass1' });

  assert.equal((await S.GET('/api/graph')).status, 200);
  assert.equal((await S.GET('/api/stories')).status, 200);
  assert.equal((await S.GET('/api/stats')).status, 200);

  const write = await S.POST('/api/persons', { name: 'Nope' });
  assert.equal(write.status, 403);
  assert.equal(write.data.error, 'err.forbidden');
  assert.equal((await S.POST('/api/branches', { name: 'Nope' })).status, 403);
  assert.equal((await S.POST('/api/stories', { title: 'Nope' })).status, 403);
  assert.equal((await S.GET('/api/users')).status, 403);
  assert.equal((await S.GET('/api/export')).status, 403);
  assert.equal((await S.POST('/api/backups')).status, 403);

  // Their own account is still theirs: language, tokens, password.
  assert.equal((await S.POST('/api/me', { lang: 'pt-BR' })).status, 200);
  assert.equal((await S.POST('/api/tokens', { name: 'meins' })).status, 200);
});

test('an editor writes the family but does not run the installation', async () => {
  S.logoutLocally();
  await S.POST('/api/login', { username: 'edda', password: 'editor-pass1' });

  const p = await S.POST('/api/persons', { name: 'Neu' });
  assert.equal(p.status, 200);
  assert.equal((await S.GET('/api/users')).status, 403);
  assert.equal((await S.POST('/api/import', { format: 'x' })).status, 403);
  assert.equal((await S.POST('/api/invites', { role: 'viewer' })).status, 403);
  assert.equal((await S.POST('/api/settings/map', { tile_url: '' })).status, 403);
});

test('roles cannot be self-served and the last admin stands', async () => {
  S.logoutLocally();
  await S.POST('/api/login', { username: 'alex', password: 'secret-enough' });
  const users = (await S.GET('/api/users')).data;
  const me = users.find(u => u.username === 'alex');
  const viola = users.find(u => u.username === 'viola');

  const self = await S.PUT(`/api/users/${me.id}`, { role: 'viewer' });
  assert.equal(self.status, 400);
  assert.equal(self.data.error, 'err.self_demote');

  const delSelf = await S.DEL(`/api/users/${me.id}`);
  assert.equal(delSelf.status, 400);

  const promote = await S.PUT(`/api/users/${viola.id}`, { role: 'editor' });
  assert.equal(promote.status, 200);
  const demote = await S.PUT(`/api/users/${viola.id}`, { role: 'viewer' });
  assert.equal(demote.status, 200);
});

test('changing your password signs your other sessions out', async () => {
  S.logoutLocally();
  await S.POST('/api/login', { username: 'edda', password: 'editor-pass1' });
  const wrong = await S.POST('/api/password', { current: 'falsch-falsch', next: 'brandneu-123' });
  assert.equal(wrong.status, 400);

  const ok = await S.POST('/api/password', { current: 'editor-pass1', next: 'brandneu-123' });
  assert.equal(ok.status, 200);
  // The old cookie is dead now.
  assert.equal((await S.GET('/api/graph')).status, 401);
  const back = await S.POST('/api/login', { username: 'edda', password: 'brandneu-123' });
  assert.equal(back.status, 200);
});
