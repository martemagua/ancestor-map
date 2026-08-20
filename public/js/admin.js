// The /admin desktop page: accounts, invites, backups, import/export,
// duplicates & merge, place backfill, instance settings. Server-guarded —
// every route it calls needs the admin role; this page just draws it.
import { api } from './api.js';
import { t, setLang, detectLang } from './i18n.js';
import { escapeHtml as esc } from './store.js';
import { toast } from './ui.js';

const $ = sel => document.querySelector(sel);

const state = { users: [], invites: [], backups: [], duplicates: [], stats: null, settings: null, graph: null };

async function boot() {
  setLang(detectLang(navigator.languages || []));
  const session = await api.get('/api/session');
  if (!session.user || session.user.role !== 'admin') { location.href = '/'; return; }
  if (session.user.lang) setLang(session.user.lang);
  await reload();
}

async function reload() {
  [state.users, state.invites, state.backups, state.duplicates, state.stats, state.settings, state.graph]
    = await Promise.all([
      api.get('/api/users'), api.get('/api/invites'), api.get('/api/backups'),
      api.get('/api/duplicates'), api.get('/api/stats'), api.get('/api/settings'),
      api.get('/api/graph'),
    ]);
  render();
}

const ROLES = ['viewer', 'editor', 'admin'];

function render() {
  $('#admin').innerHTML = `
    <header>
      <h1>${esc(t('adm.title'))}</h1>
      <a class="btn sm" href="/">${esc(t('adm.back'))}</a>
    </header>

    <section>
      <h2>${esc(t('adm.stats'))}</h2>
      <div class="statgrid">
        ${[['persons', t('tab.people')], ['unions', t('union.title')], ['stories', t('tab.stories')],
    ['branches', t('br.title')], ['sources', t('adm.sources')], ['relationships', t('card.relationships')]]
    .map(([key, label]) => `<div class="statbox"><b>${state.stats[key] ?? 0}</b><span>${esc(label)}</span></div>`).join('')}
      </div>
    </section>

    <section>
      <h2>${esc(t('adm.users'))}</h2>
      <table class="tbl"><thead><tr>
        <th>${esc(t('ui.username'))}</th><th>${esc(t('adm.role'))}</th><th>${esc(t('ui.email'))}</th>
        <th>${esc(t('adm.person'))}</th><th></th>
      </tr></thead><tbody>
        ${state.users.map(u => `<tr data-user="${u.id}">
          <td><b>${esc(u.username)}</b></td>
          <td><select data-role>${ROLES.map(r =>
    `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(t('role.' + r))}</option>`).join('')}</select></td>
          <td>${esc(u.email || '–')}</td>
          <td>${esc(u.person_name || '–')}</td>
          <td><button class="btn sm danger" data-del>${esc(t('ui.delete'))}</button></td>
        </tr>`).join('')}
      </tbody></table>
      <div class="formrow" data-newuser>
        <label>${esc(t('ui.username'))}<input data-nu></label>
        <label>${esc(t('ui.password'))}<input data-np type="password"></label>
        <label>${esc(t('adm.role'))}<select data-nr>${ROLES.map(r =>
    `<option value="${r}">${esc(t('role.' + r))}</option>`).join('')}</select></label>
        <label>${esc(t('ui.name'))}<input data-nn placeholder="${esc(t('adm.person_opt'))}"></label>
        <button class="btn sm primary" data-create>${esc(t('adm.create_user'))}</button>
      </div>
    </section>

    <section>
      <h2>${esc(t('adm.invites'))}</h2>
      <div class="formrow">
        <label>${esc(t('adm.role'))}<select data-ir>${ROLES.map(r =>
    `<option value="${r}" ${r === 'viewer' ? 'selected' : ''}>${esc(t('role.' + r))}</option>`).join('')}</select></label>
        <label>${esc(t('adm.invite_for'))}<input data-iname></label>
        <button class="btn sm primary" data-invite>${esc(t('adm.invite_new'))}</button>
      </div>
      <div data-invitelink></div>
      ${state.invites.length ? `<table class="tbl" style="margin-top:12px"><thead><tr>
        <th>${esc(t('adm.role'))}</th><th>${esc(t('ui.name'))}</th><th>${esc(t('adm.invite_state'))}</th><th></th>
      </tr></thead><tbody>
        ${state.invites.map(i => `<tr>
          <td>${esc(t('role.' + i.role))}</td>
          <td>${esc(i.invited_name || '–')}</td>
          <td>${i.used_at ? esc(t('adm.invite_used')) : esc(String(i.expires_at).slice(0, 10))}</td>
          <td>${i.used_at ? '' : `<button class="btn sm" data-delinvite="${esc(i.token_hash)}">${esc(t('ui.delete'))}</button>`}</td>
        </tr>`).join('')}
      </tbody></table>` : ''}
    </section>

    <section>
      <h2>${esc(t('adm.data'))}</h2>
      <div class="btnrow" style="max-width:560px">
        <a class="btn" href="/api/export" download>${esc(t('adm.export'))}</a>
        <button class="btn" data-backup>${esc(t('adm.backup_now'))}</button>
        <button class="btn" data-geo>${esc(t('adm.geo_go'))}</button>
      </div>
      <div class="formrow">
        <label>${esc(t('adm.import'))}<input type="file" accept=".json,application/json" data-importfile></label>
        <label class="check" style="padding:0"><input type="checkbox" data-replace> ${esc(t('adm.import_replace'))}</label>
        <button class="btn sm" data-import>${esc(t('adm.import_go'))}</button>
      </div>
      ${state.backups.length ? `<p class="muted" style="margin-top:10px">${esc(t('adm.backups'))}:
        ${state.backups.slice(0, 5).map(b => esc(b.name)).join(' · ')}</p>` : ''}
    </section>

    <section>
      <h2>${esc(t('adm.dups'))}</h2>
      ${state.duplicates.length ? state.duplicates.map((group, gi) => `<div class="dupgroup" data-group="${gi}">
        ${group.map(p => `<div class="rowline">
          <b style="flex:1">${esc(p.name)}</b>
          <span class="muted">${esc(p.birth || '')}</span>
          <button class="btn sm" data-keep="${p.id}">${esc(t('adm.keep'))}</button>
        </div>`).join('')}
      </div>`).join('') : `<p class="muted">${esc(t('adm.dups_none'))}</p>`}
    </section>

    <section>
      <h2>${esc(t('adm.settings'))}</h2>
      <div class="formrow">
        <label style="flex:1;min-width:320px">${esc(t('adm.tile'))}
          <input data-tile value="${esc(state.settings.map?.tile_url || '')}" placeholder="https://…/{z}/{x}/{y}.png"></label>
        <button class="btn sm" data-savetile>${esc(t('ui.save'))}</button>
      </div>
      <p class="muted" style="margin-top:14px">Ancestor Map v${esc(state.settings.build?.version || '')} · ${esc(state.settings.build?.commit || '')}</p>
    </section>`;

  wire();
}

function wire() {
  // Accounts
  document.querySelectorAll('[data-user]').forEach(row => {
    const id = Number(row.dataset.user);
    row.querySelector('[data-role]').onchange = async e => {
      try { await api.put(`/api/users/${id}`, { role: e.target.value }); toast(t('form.saved')); }
      catch (err) { toast(err.message); }
      reload();
    };
    row.querySelector('[data-del]').onclick = async () => {
      if (!confirm(t('ui.confirm_delete'))) return;
      try { await api.del(`/api/users/${id}`); toast(t('form.deleted')); await reload(); }
      catch (err) { toast(err.message); }
    };
  });
  $('[data-create]').onclick = async () => {
    try {
      await api.post('/api/users', {
        username: $('[data-nu]').value.trim(), password: $('[data-np]').value,
        role: $('[data-nr]').value, person_name: $('[data-nn]').value.trim() || undefined,
      });
      toast(t('form.saved'));
      await reload();
    } catch (err) { toast(err.message); }
  };

  // Invites — the token is only ever readable right now, so show the link
  // immediately; the list below can never reconstruct it.
  $('[data-invite]').onclick = async () => {
    try {
      const out = await api.post('/api/invites', {
        role: $('[data-ir]').value, invited_name: $('[data-iname]').value.trim(),
      });
      const link = `${location.origin}/join?token=${encodeURIComponent(out.token)}`;
      $('[data-invitelink]').innerHTML = `<div class="copyrow">
        <input readonly value="${esc(link)}"><button class="btn sm" data-copy>${esc(t('adm.invite_link'))}</button>
      </div>`;
      $('[data-copy]').onclick = async () => {
        try { await navigator.clipboard.writeText(link); } catch { $('[data-invitelink] input').select(); }
        toast(t('adm.invite_copied'));
      };
    } catch (err) { toast(err.message); }
  };
  document.querySelectorAll('[data-delinvite]').forEach(btn => {
    btn.onclick = async () => {
      try { await api.del(`/api/invites/${btn.dataset.delinvite}`); await reload(); }
      catch (err) { toast(err.message); }
    };
  });

  // Data
  $('[data-backup]').onclick = async () => {
    try { const out = await api.post('/api/backups'); toast(out.json); await reload(); }
    catch (err) { toast(err.message); }
  };
  $('[data-geo]').onclick = async () => {
    try {
      const out = await api.post('/api/geo/backfill', { max: 20 });
      toast(t('adm.geo_done', { n: out.done.length, left: out.left }));
    } catch (err) { toast(err.message); }
  };
  $('[data-import]').onclick = async () => {
    const file = $('[data-importfile]').files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const out = await api.post('/api/import', { data, replace: $('[data-replace]').checked });
      toast(t('adm.import_done', { n: out.persons }));
      await reload();
    } catch (err) { toast(err.message); }
  };

  // Duplicates: first "keep" arms the group, the second click on another row
  // is the person who folds into it.
  document.querySelectorAll('[data-group]').forEach(group => {
    let keep = null;
    group.querySelectorAll('[data-keep]').forEach(btn => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.keep);
        if (keep == null) {
          keep = id;
          btn.classList.add('primary');
          btn.textContent = t('adm.now_pick_drop');
          return;
        }
        if (id === keep) return;
        const keepName = state.graph.persons.find(p => p.id === keep)?.name;
        const dropName = state.graph.persons.find(p => p.id === id)?.name;
        if (!confirm(t('adm.merge_confirm', { keep: keepName, drop: dropName }))) return;
        try {
          await api.post('/api/persons/merge', { keep, drop: id });
          toast(t('form.saved'));
          await reload();
        } catch (err) { toast(err.message); }
      };
    });
  });

  // Settings
  $('[data-savetile]').onclick = async () => {
    try {
      await api.post('/api/settings/map', { tile_url: $('[data-tile]').value.trim() });
      toast(t('form.saved'));
    } catch (err) { toast(err.message); }
  };
}

boot().catch(err => {
  document.body.innerHTML = `<div class="empty" style="padding-top:80px"><span class="big">🔌</span><div>${esc(err.message)}</div></div>`;
});
