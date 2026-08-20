// The /join page: a family member lands here from an invitation link and
// creates their account. The role travels with the invite; this page never
// gets to choose it.
import { api } from './api.js';
import { t, setLang, detectLang, LANGS, LANG_NAMES, getLang } from './i18n.js';

setLang(detectLang(navigator.languages || [navigator.language]));

const gate = document.getElementById('gate');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const token = new URLSearchParams(location.search).get('token') || '';

function show(html) {
  gate.innerHTML = `<div class="gatebox">
    <div class="gatemark">
      <i style="background:#A6743C"></i><i style="background:#3E7CB1"></i><i style="background:#D1495B"></i>
      <i style="background:#5AA469"></i><i style="background:#8E6BAD"></i>
    </div>${html}</div>`;
}

async function boot() {
  const info = await api.get(`/api/invite?token=${encodeURIComponent(token)}`);
  if (!info.valid) {
    show(`<h1>Ancestor Map</h1><p class="lead">${esc(t('join.invalid'))}</p>
      <a class="btn wide" href="/" style="margin-top:18px">${esc(t('ui.back'))}</a>`);
    return;
  }
  show(`
    <h1>${esc(t('join.title'))}</h1>
    <p class="lead">${esc(t('join.intro', { role: t('role.' + info.role) }))}</p>
    <label class="field"><span>${esc(t('join.name'))}</span>
      <input data-n value="${esc(info.invited_name || '')}"></label>
    <label class="field"><span>${esc(t('ui.username'))}</span><input data-u autocomplete="username"></label>
    <label class="field"><span>${esc(t('ui.password'))}</span><input data-p type="password" autocomplete="new-password"></label>
    <label class="field"><span>${esc(t('ui.language'))}</span>
      <select data-l>${LANGS.map(l =>
        `<option value="${l}" ${getLang() === l ? 'selected' : ''}>${esc(LANG_NAMES[l])}</option>`).join('')}</select></label>
    <div class="err" data-err></div>
    <button class="btn primary wide" data-go style="margin-top:6px">${esc(t('join.go'))}</button>`);

  gate.querySelector('[data-go]').onclick = async () => {
    try {
      const username = gate.querySelector('[data-u]').value.trim();
      const password = gate.querySelector('[data-p]').value;
      await api.post('/api/invite/accept', {
        token, username, password,
        name: gate.querySelector('[data-n]').value.trim(),
        lang: gate.querySelector('[data-l]').value,
      });
      await api.post('/api/login', { username, password });
      location.href = '/';
    } catch (err) { gate.querySelector('[data-err]').textContent = err.message; }
  };
}

boot().catch(err => show(`<h1>Ancestor Map</h1><p class="lead">${esc(err.message)}</p>`));
