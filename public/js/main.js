// Boot, the login/setup gate, tab switching and everything the tree tab owns.
import { api } from './api.js';
import {
  S, loadGraph, loadStories, loadSettings, loadPeopleView,
  escapeHtml, chipTree, withDescendants, proband, kinLabel,
} from './store.js';
import {
  initMap, draw, reheat, fitView, focusPerson, setPhysics, physicsEnabled,
  shake, setAllEdges, allEdgesShown, setLayoutMode, layoutMode,
} from './map.js';
import {
  bindRefresh, bindFocus, bindTreeFrom, openPerson, openQuickAdd, openSettings,
  openBranches, setTheme, toast, closeSheet, closeSheetFromBackdrop, canEdit,
} from './ui.js';
import { renderPeople, renderStories, renderPlaces } from './views.js';
import { t, setLang, detectLang } from './i18n.js';

const $ = sel => document.querySelector(sel);
let currentTab = 'tree';

// ------------------------------------------------------------------ i18n & theme

// Before anyone is logged in the gate follows the browser; a logged-in
// account's own choice wins the moment the session answers.
setLang(detectLang(navigator.languages || [navigator.language]));
setTheme(localStorage.getItem('am-theme') || 'auto');
window.addEventListener('am-theme', () => draw());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw());

/** Static strings in index.html carry data-t / data-t-* attributes. */
function localizeShell() {
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-title]').forEach(el => { el.title = t(el.dataset.tTitle); });
  document.querySelectorAll('[data-t-ph]').forEach(el => { el.placeholder = t(el.dataset.tPh); });
  document.querySelectorAll('[data-t-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.tAria)); });
}

// ------------------------------------------------------------------ gate

async function boot() {
  const session = await api.get('/api/session');
  if (session.needs_setup) return showSetup();
  if (!session.user) return showLogin();
  applySession(session.user);
  await startApp();
}

function applySession(user) {
  S.user = user;
  S.mePersonId = user.person_id;
  if (user.lang) setLang(user.lang);
}

function gate(html, onMount) {
  const g = $('#gate');
  g.innerHTML = `<div class="gatebox">
    <div class="gatemark">
      <i style="background:#A6743C"></i><i style="background:#3E7CB1"></i><i style="background:#D1495B"></i>
      <i style="background:#5AA469"></i><i style="background:#8E6BAD"></i>
    </div>${html}</div>`;
  g.classList.remove('hidden');
  onMount?.(g);
}

function showLogin() {
  gate(`
    <h1>Ancestor Map</h1>
    <p class="lead">${escapeHtml(t('gate.who'))}</p>
    <label class="field"><span>${escapeHtml(t('ui.username'))}</span><input data-u autocomplete="username"></label>
    <label class="field"><span>${escapeHtml(t('ui.password'))}</span><input data-p type="password" autocomplete="current-password"></label>
    <div class="err" data-err></div>
    <button class="btn primary wide" data-go style="margin-top:6px">${escapeHtml(t('ui.login'))}</button>
    <button class="btn ghost wide" data-forgot style="margin-top:10px">${escapeHtml(t('gate.forgot'))}</button>`,
    g => {
      const go = async () => {
        try {
          const out = await api.post('/api/login', {
            username: g.querySelector('[data-u]').value,
            password: g.querySelector('[data-p]').value,
          });
          applySession(out.user);
          g.classList.add('hidden');
          await startApp();
        } catch (err) { g.querySelector('[data-err]').textContent = err.message; }
      };
      g.querySelector('[data-go]').onclick = go;
      g.querySelector('[data-forgot]').onclick = () => showForgot();
      g.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }));
      g.querySelector('[data-u]').focus();
    });
}

function showForgot() {
  gate(`
    <h1>${escapeHtml(t('gate.forgot'))}</h1>
    <p class="lead">${escapeHtml(t('gate.forgot_how'))}</p>
    <p class="lead" style="margin-top:12px"><code style="font-size:13px">docker exec -it ancestormap node server/reset-password.js USERNAME NEW-PASSWORD</code></p>
    <button class="btn wide" data-back style="margin-top:18px">${escapeHtml(t('ui.back'))}</button>`,
    g => { g.querySelector('[data-back]').onclick = showLogin; });
}

function showSetup() {
  gate(`
    <h1>${escapeHtml(t('setup.title'))}</h1>
    <p class="lead">${escapeHtml(t('setup.intro'))}</p>
    <label class="field"><span>${escapeHtml(t('ui.name'))}</span><input data-n placeholder="Alex"></label>
    <label class="field"><span>${escapeHtml(t('ui.username'))}</span><input data-u autocomplete="username"></label>
    <label class="field"><span>${escapeHtml(t('ui.password'))}</span><input data-p type="password" autocomplete="new-password"></label>
    <label class="field"><span>${escapeHtml(t('ui.email'))} <span class="muted">(optional)</span></span><input data-e type="email" autocomplete="email"></label>
    <div class="err" data-err></div>
    <button class="btn primary wide" data-go style="margin-top:6px">${escapeHtml(t('setup.create'))}</button>`,
    g => {
      g.querySelector('[data-go]').onclick = async () => {
        const v = sel => g.querySelector(sel).value.trim();
        try {
          const { getLang } = await import('./i18n.js');
          await api.post('/api/setup', {
            name: v('[data-n]'), username: v('[data-u]'),
            password: g.querySelector('[data-p]').value,
            email: v('[data-e]'), lang: getLang(),
          });
          const out = await api.post('/api/login', { username: v('[data-u]'), password: g.querySelector('[data-p]').value });
          applySession(out.user);
          g.classList.add('hidden');
          await startApp();
        } catch (err) { g.querySelector('[data-err]').textContent = err.message; }
      };
      g.querySelector('[data-n]').focus();
    });
}

async function logout() {
  await api.post('/api/logout');
  location.reload();
}

// ------------------------------------------------------------------ app

async function startApp() {
  localizeShell();
  $('#app').classList.remove('hidden');
  loadPeopleView();
  await loadSettings();
  await refreshAll();

  initMap($('#map'), { onSelect: openPerson });
  bindRefresh(refreshAll);
  bindFocus(id => { switchTab('tree'); focusPerson(id); });
  bindTreeFrom(id => {
    setProband(id);
    closeSheet();
    switchTab('tree');
    focusPerson(id);
  });

  fitView();
  reheat(1);

  const fab = $('#fab');
  if (canEdit()) fab.onclick = () => openQuickAdd({});
  else fab.hidden = true;

  $('#btn-fit').onclick = () => fitView();
  $('#btn-edges').onclick = e => {
    setAllEdges(!allEdgesShown());
    e.currentTarget.classList.toggle('on', allEdgesShown());
  };
  $('#btn-shake').onclick = shake;
  $('#btn-physics').onclick = e => {
    const on = setPhysics(!physicsEnabled());
    e.currentTarget.classList.toggle('on', on);
    e.currentTarget.textContent = on ? '🧲' : '📌';
  };
  // The tree's Y axis: generations, or the years themselves.
  $('#btn-zeit').onclick = e => {
    const mode = layoutMode() === 'zeit' ? 'gen' : 'zeit';
    setLayoutMode(mode);
    e.currentTarget.classList.toggle('on', mode === 'zeit');
    reheat(1);
    draw();
  };
  $('#btn-branches').onclick = openBranches;
  $('#btn-settings').onclick = () => openSettings({ onLogout: logout });
  $('#scrim').onclick = closeSheetFromBackdrop;

  const search = $('#search');
  search.oninput = () => { S.search = search.value; renderPeople(); draw(); };

  document.querySelectorAll('#tabbar button').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
}

async function refreshAll() {
  await Promise.all([loadGraph(), loadStories()]);
  renderProband();
  renderChips();
  renderPeople();
  if (currentTab === 'stories') renderStories();
  if (currentTab === 'places') renderPlaces();
  draw();
}

// ------------------------------------------------------------------ proband

/**
 * Whose tree we are reading. The chip in the top bar names them; when it is
 * not you, tapping it walks back home. Kinship labels, generations on the
 * map and the card's relation line all recompute from this one value.
 */
function setProband(id) {
  S.probandId = id;
  S.probandPinned = true;          // a deliberate choice outranks the default
  S.persons.forEach(p => { p._gen = undefined; });   // the layout re-derives
  renderProband();
  renderPeople();
  reheat(1);
  draw();
}

function renderProband() {
  const host = $('#proband');
  const p = proband();
  if (!p) { host.hidden = true; return; }
  const isMe = p.id === S.mePersonId;
  host.hidden = false;
  host.innerHTML = `<button class="chip ${isMe ? 'on' : 'lit'}" style="--c:var(--accent)"
    title="${escapeHtml(isMe ? t('prob.you_hint') : t('prob.reset'))}">🌳 ${escapeHtml(p.name)}${isMe ? '' : ' ×'}</button>`;
  host.querySelector('button').onclick = () => {
    if (!isMe && S.personById[S.mePersonId]) setProband(S.mePersonId);
    else if (p) { openPerson(p.id); }
  };
}

// ------------------------------------------------------------------ branch chips

const chipState = id => (!S.activeBranches.has(id) ? 'off' : S.litBranches.has(id) ? 'lit' : 'on');

function renderChips() {
  const strip = $('#chips');
  const titles = { on: t('chip.hint_on'), lit: t('chip.hint_lit'), off: t('chip.hint_off') };
  strip.innerHTML = chipTree().map(({ branch: b, depth, kids }) => {
    const state = chipState(b.id);
    const chip = `<button class="chip ${state}${depth ? ' sub' : ''}" data-branch="${b.id}"
      style="--c:${escapeHtml(b.color)}" title="${escapeHtml(titles[state])}">
      <span class="dot" style="background:${escapeHtml(b.color)}"></span>${escapeHtml(b.emoji ? b.emoji + ' ' : '')}${
      escapeHtml(b.name)}</button>`;
    if (!kids) return chip;
    const open = S.openBranches.has(b.id);
    return chip + `<button class="chip fold ${state}" data-open="${b.id}"
      aria-expanded="${open}">${open ? '▾' : '▸'}${open ? '' : ' ' + kids}</button>`;
  }).join('')
    + `<button class="chip ${S.showUnbranched ? 'on' : 'off'}" data-unbranched>
        <span class="dot" style="background:var(--ungrouped)"></span>${escapeHtml(t('quick.nobranch'))}</button>`;

  strip.querySelectorAll('[data-branch]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.branch);
      const next = { on: 'lit', lit: 'off', off: 'on' }[chipState(id)];
      // A folded chip stands for its whole subtree — switching only the
      // parent off would leave its children on the map with no chip left.
      for (const sub of withDescendants(id)) {
        S.activeBranches[next === 'off' ? 'delete' : 'add'](sub);
        S.litBranches[next === 'lit' ? 'add' : 'delete'](sub);
      }
      renderChips();
      renderPeople(); reheat(0.4); draw();
    };
  });
  strip.querySelectorAll('[data-open]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.open);
      S.openBranches[S.openBranches.has(id) ? 'delete' : 'add'](id);
      renderChips();
    };
  });
  strip.querySelector('[data-unbranched]').onclick = () => {
    S.showUnbranched = !S.showUnbranched;
    renderChips();
    renderPeople(); reheat(0.4); draw();
  };
  syncChipToggle();
}

const CHIPS_KEY = 'am-chips-open';

function syncChipToggle() {
  const bar = $('#chipbar'), strip = $('#chips'), btn = $('#chips-expand');
  const open = bar.classList.contains('open');
  btn.hidden = !open && strip.scrollWidth <= strip.clientWidth + 1;
  btn.setAttribute('aria-expanded', String(open));
}

try { if (localStorage.getItem(CHIPS_KEY) === '1') $('#chipbar').classList.add('open'); } catch { /* fine */ }
$('#chips-expand').onclick = () => {
  const open = $('#chipbar').classList.toggle('open');
  try { localStorage.setItem(CHIPS_KEY, open ? '1' : '0'); } catch { /* private mode */ }
  syncChipToggle();
  draw();
};
new ResizeObserver(() => syncChipToggle()).observe($('#chips'));

// ------------------------------------------------------------------ tabs

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== tab; });
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'tree') { draw(); reheat(0.3); }
  if (tab === 'people') renderPeople();
  if (tab === 'stories') renderStories();
  if (tab === 'places') renderPlaces();
}

// ------------------------------------------------------------------ go

boot().catch(err => {
  document.body.innerHTML = `<div class="empty"><span class="big">🔌</span><div>${escapeHtml(err.message)}</div></div>`;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
