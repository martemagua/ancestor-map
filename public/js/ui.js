// Sheets, toasts and every form in the app. The framework half (openSheet,
// toast, personPicker, the registry-driven field renderer) is Friend-Map's;
// the forms are Ancestor Map's own.
import { api } from './api.js';
import {
  S, REL_KINDS, relKind, UNION_KINDS, CHILD_ROLES, colorOf, initials, escapeHtml,
  branchesWithParents, ancestorsOf, treeOrder, suggestBranchColor, lighten,
  parentsOfP, siblingsOfP, unionsOfP, unionPartners, unionChildren,
  kinLabel, relsOf, otherEnd, otherViewsOf, lifespan, buildLabel, branchPalette,
} from './store.js';
import { FIELDS, SECTIONS, fieldsIn, fromStored, toStored, isEmpty } from './fields.js';
import { formatFuzzy, composeFuzzy, toParts } from './fuzzydate.js';
import { t, LANGS, LANG_NAMES, getLang } from './i18n.js';

let refresh = async () => {};
export const bindRefresh = fn => { refresh = fn; };
export const refreshNow = () => refresh();

let onFocusPerson = () => {};
export const bindFocus = fn => { onFocusPerson = fn; };

let onTreeFrom = () => {};
export const bindTreeFrom = fn => { onTreeFrom = fn; };

/** Whether this account may change the family data — mirrors the server gate. */
export const canEdit = () => ['editor', 'admin'].includes(S.user?.role);
export const isAdmin = () => S.user?.role === 'admin';

// ------------------------------------------------------------------ sheet

const scrim = () => document.getElementById('scrim');
const sheet = () => document.getElementById('sheet');
let openedAt = 0;

export function openSheet(title, bodyHtml, { onMount, subtitle = '' } = {}) {
  const el = sheet();
  el.innerHTML = `
    <div class="grip"></div>
    <div class="sheethead">
      <div style="flex:1;min-width:0">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<div class="muted">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      <button class="close" data-close aria-label="${escapeHtml(t('ui.close'))}">×</button>
    </div>
    <div class="sheetbody">${bodyHtml}</div>`;
  el.querySelector('[data-close]').onclick = closeSheet;
  // The sheet stays in the DOM when closed (tests select `.sheet.show`), only
  // translated off-screen — `inert` keeps its buttons out of the Tab order.
  el.inert = false;
  el.setAttribute('aria-label', title);
  el.classList.add('show');
  scrim().classList.add('show');
  openedAt = Date.now();
  document.body.dataset.sheet = 'open';
  if (onMount) onMount(el.querySelector('.sheetbody'));
  el.querySelector('.sheetbody').scrollTop = 0;
  if (!el.contains(document.activeElement)) el.querySelector('[data-close]').focus({ preventScroll: true });
}

/**
 * Tapping a dot opens a card — and the browser then sends the click for that
 * same tap, by which time the backdrop is what sits under the finger.
 */
export function closeSheetFromBackdrop() {
  if (Date.now() - openedAt > 300) closeSheet();
}

export function closeSheet() {
  const el = sheet();
  if (el.contains(document.activeElement)) document.activeElement.blur();
  el.inert = true;
  el.classList.remove('show');
  scrim().classList.remove('show');
  delete document.body.dataset.sheet;
}

export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ bits

export function avatarHtml(p, size = '') {
  const cls = `avatar ${size}`.trim();
  const bg = p.id === S.probandId ? 'var(--ink)' : (colorOf(p) || 'var(--ungrouped)');
  return `<span class="${cls}" style="background:${escapeHtml(bg)}">${escapeHtml(initials(p.name))}</span>`;
}

/** Only ever hand http(s) to an href — a pasted `javascript:` URL stays inert. */
export function safeUrl(raw) {
  try {
    const u = new URL(String(raw), location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch { return ''; }
}

const val = (root, name) => root.querySelector(`[data-f="${name}"]`)?.value ?? '';
const checked = (root, sel) => [...root.querySelectorAll(sel)].filter(i => i.checked).map(i => Number(i.value));

function branchIndent(b) {
  const depth = ancestorsOf(b.id).length;
  return depth ? `<span class="muted">${'&nbsp;'.repeat((depth - 1) * 2)}↳ </span>` : '';
}

/**
 * A person chooser that survives five hundred ancestors: type a few letters,
 * tap the match. A chosen person is a chip; tapping it starts over. The
 * current id lives on the host's `data-value` so forms read it back.
 */
export function personPicker(host, {
  selected = null, exclude = [], placeholder = '', onChange = null, locked = false,
} = {}) {
  host.classList.add('ppick');
  host.dataset.value = selected ?? '';
  const notify = () => onChange && onChange(Number(host.dataset.value) || null);
  const norm = s => String(s || '').toLowerCase();
  const ph = placeholder || t('add.person_ph');

  const rank = q => {
    const list = S.persons.filter(p => !p.archived && !exclude.includes(p.id));
    if (!q) {
      // Nothing typed: the most recently touched people first — a new
      // relative usually hangs next to whoever you just worked on.
      return list.slice()
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .slice(0, 8);
    }
    // Names beyond the display one count too — a grandmother recorded under
    // her maiden name is still found by it.
    const hay = p => [p.name, p.birth_name, p.nickname, p.full_name]
      .filter(Boolean).map(norm);
    return list
      .map(p => {
        const names = hay(p);
        const score = names.some(n => n.startsWith(q)) ? 3
          : names.some(n => n.split(/\s+/).some(w => w.startsWith(q))) ? 2
            : names.some(n => n.includes(q)) ? 1 : 0;
        return { p, score };
      })
      .filter(x => x.score)
      .sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, getLang()))
      .slice(0, 12)
      .map(x => x.p);
  };

  const draw = () => {
    const chosen = S.personById[Number(host.dataset.value)] || null;
    if (chosen) {
      host.innerHTML = `<button type="button" class="ppick-chosen" ${locked ? 'disabled' : ''}>
        ${avatarHtml(chosen, 'sm')}<span class="nm">${escapeHtml(chosen.name)}</span>${locked ? '' : '<span class="x">×</span>'}</button>`;
      if (!locked) {
        host.querySelector('.ppick-chosen').onclick = () => {
          host.dataset.value = '';
          draw();
          host.querySelector('input').focus();
          notify();
        };
      }
      return;
    }
    host.innerHTML = `<input type="text" placeholder="${escapeHtml(ph)}" autocomplete="off">
      <div class="ppick-list" hidden></div>`;
    const input = host.querySelector('input');
    const list = host.querySelector('.ppick-list');
    const show = () => {
      const hits = rank(norm(input.value.trim()));
      list.hidden = !hits.length;
      list.innerHTML = hits.map(p => `<button type="button" class="ppick-hit" data-pick="${p.id}">
        ${avatarHtml(p, 'sm')}<span><b>${escapeHtml(p.name)}</b><span class="sub">${
          escapeHtml(lifespan(p) || kinLabel(p.id))}</span></span></button>`).join('');
      list.querySelectorAll('[data-pick]').forEach(b => {
        // pointerdown beats the blur a tap causes — same fix as the place
        // picker, and the reason a hit can be chosen on the first tap.
        b.onpointerdown = e => { e.preventDefault(); host.dataset.value = b.dataset.pick; draw(); notify(); };
      });
    };
    input.oninput = show;
    input.onfocus = show;
  };

  draw();
  return {
    get value() { return Number(host.dataset.value) || null; },
    set(id) { host.dataset.value = id ?? ''; draw(); },
  };
}

// ------------------------------------------------------------------ dates
//
// Genealogy dates are half-known far more often than not, so the picker is
// built around the grammar rather than around a calendar: a qualifier, then
// year / month / day, each of which may simply be left out. A browser's
// native date input cannot say "um 1885" or "1885, month unknown" — it wants
// a whole day or nothing — which is why there is a hand-made one here.
//
// It writes into a hidden input carrying the field's `data-f`, so every
// existing reader (val(), readFields()) goes on working without knowing a
// picker happened.

const FD_KINDS = ['exact', 'circa', 'before', 'after', 'range', 'text'];

export function fuzzyDateHtml(key, value, { label = '' } = {}) {
  const st = toParts(value);
  const months = t('date.months').split('|');
  const opts = (list, sel, blank) =>
    `<option value="">${escapeHtml(blank)}</option>` + list.map(([v, txt]) =>
      `<option value="${v}"${String(sel) === String(v) ? ' selected' : ''}>${escapeHtml(txt)}</option>`).join('');
  const side = (which, parts) => `
    <div class="fd-parts" data-fd-side="${which}">
      <input data-fd="y" type="number" inputmode="numeric" min="1" max="9999"
        placeholder="${escapeHtml(t('fd.year'))}" value="${escapeHtml(parts.y)}" autocomplete="off">
      <select data-fd="m">${opts(months.map((n, i) => [i + 1, n]), parts.m, t('fd.month'))}</select>
      <select data-fd="d">${opts(Array.from({ length: 31 }, (_, i) => [i + 1, i + 1]), parts.d, t('fd.day'))}</select>
    </div>`;

  return `<div class="field fdate" data-fdate="${key}">
    ${label ? `<span>${escapeHtml(label)}</span>` : ''}
    <input type="hidden" data-f="${key}" value="${escapeHtml(value ?? '')}">
    <select data-fd="kind">${FD_KINDS.map(k =>
    `<option value="${k}"${st.kind === k ? ' selected' : ''}>${escapeHtml(t('fd.' + k))}</option>`).join('')}</select>
    ${side('a', st.a)}
    <div class="fd-to" data-fd-to>${escapeHtml(t('fd.to'))}</div>
    ${side('b', st.b)}
    <input data-fd="raw" class="fd-raw" value="${escapeHtml(st.raw)}"
      placeholder="${escapeHtml(t('fd.raw_ph'))}" autocomplete="off">
    <div class="fd-preview" data-fd-preview aria-live="polite"></div>
  </div>`;
}

/** Wire every picker inside `root`: keep the hidden input and the preview true. */
export function mountFuzzyDates(root) {
  for (const box of root.querySelectorAll('[data-fdate]')) {
    const q = sel => box.querySelector(sel);
    const out = q('input[type="hidden"]');
    const kindEl = q('[data-fd="kind"]');
    const partOf = which => {
      const s = box.querySelector(`[data-fd-side="${which}"]`);
      return { y: s.querySelector('[data-fd="y"]').value, m: s.querySelector('[data-fd="m"]').value, d: s.querySelector('[data-fd="d"]').value };
    };
    const sync = () => {
      const kind = kindEl.value;
      const isText = kind === 'text';
      const isRange = kind === 'range';
      box.classList.toggle('is-text', isText);
      box.classList.toggle('is-range', isRange);
      // A day with no month cannot be stored, so it is not offered either —
      // an enabled control that silently drops what you pick is a small lie.
      for (const which of ['a', 'b']) {
        const s = box.querySelector(`[data-fd-side="${which}"]`);
        const day = s.querySelector('[data-fd="d"]');
        day.disabled = !s.querySelector('[data-fd="m"]').value;
        if (day.disabled) day.value = '';
      }
      out.value = composeFuzzy({ kind, a: partOf('a'), b: partOf('b'), raw: q('[data-fd="raw"]').value });
      const shown = formatFuzzy(out.value);
      q('[data-fd-preview]').textContent = shown && shown !== out.value ? shown : '';
      box.dispatchEvent(new Event('change', { bubbles: true }));
    };
    box.querySelectorAll('[data-fd]').forEach(el => {
      el.addEventListener('input', sync);
      el.addEventListener('change', sync);
    });
    sync();
  }
}

// ------------------------------------------------------------------ form fields
//
// One renderer and one reader for every field in the registry. Adding a type
// here is the only reason to touch this again.

function fieldHtml(field, raw) {
  const value = fromStored(field, raw === undefined ? '' : toStored(field, raw));
  const shown = field.type === 'tags' ? value.join(', ') : value ?? '';
  const hint = field.scope === 'gemeinsam'
    ? `<span class="shareflag" title="${escapeHtml(t('form.shared_hint'))}">${escapeHtml(t('form.shared'))}</span>` : '';
  const label = `<span>${escapeHtml(t(field.label))}${hint}</span>`;
  const ph = field.placeholder ? ` placeholder="${escapeHtml(t(field.placeholder))}"` : '';

  // A picker is a block of controls, not one input, so it brings its own
  // label and is not wrapped in the <label> the simple types use.
  if (field.type === 'fuzzydate') {
    return fuzzyDateHtml(field.key, shown, { label: t(field.label) });
  }

  const input = () => {
    switch (field.type) {
      case 'textarea':
        return `<textarea data-f="${field.key}"${ph}>${escapeHtml(shown)}</textarea>`;
      case 'number':
        return `<input data-f="${field.key}" type="number" inputmode="numeric" value="${escapeHtml(shown === null ? '' : shown)}"${ph}>`;
      case 'bool':
        return `<input data-f="${field.key}" type="checkbox" ${value ? 'checked' : ''}>`;
      default:
        return `<input data-f="${field.key}" value="${escapeHtml(shown)}"${ph}>`;
    }
  };
  return `<label class="field">${label}${input()}</label>`;
}

function readFields(root) {
  const out = {};
  for (const field of FIELDS) {
    const el = root.querySelector(`[data-f="${field.key}"]`);
    if (!el) continue;
    out[field.key] = field.type === 'bool' ? el.checked : el.value;
  }
  return out;
}

/** This person's stories, oldest first — their timeline on the card. */
const storiesOf = personId => (S.stories || [])
  .filter(s => s.people.includes(personId))
  .map(s => ({ ...s, year: s.date_year }))
  .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));

/**
 * What the other accounts wrote, where it differs from what you see — the
 * footnote on a card, marked with one small figure; the name is on the icon.
 */
function footnote(personId, key) {
  return otherViewsOf(personId, key).map(({ who, value }) =>
    `<div class="alsosaid"><span class="who" title="${escapeHtml(who)}" aria-label="${escapeHtml(who)}">👤</span>${
      escapeHtml(value)}</div>`).join('');
}

// ------------------------------------------------------------------ person card

export function openPerson(id) {
  const p = S.personById[id];
  if (!p) return;
  const kin = id === S.probandId ? t('kin.self') : kinLabel(id);

  const factRows = [];
  if (p.birth || p.birth_place) {
    factRows.push(['🌱', `${t('p.birth')}: ${[formatFuzzy(p.birth), p.birth_place].filter(Boolean).join(' · ')}`]);
  }
  if (p.death || p.death_place) {
    factRows.push(['🕯️', `${t('p.death')}: ${[formatFuzzy(p.death), p.death_place].filter(Boolean).join(' · ')}`]);
  }
  const registryRows = FIELDS
    .filter(f => f.section && f.type !== 'tags' && f.key !== 'notes')
    .map(f => ({ f, value: p[f.key], others: otherViewsOf(id, f.key) }))
    .filter(({ f, value, others }) => !isEmpty(f, value) || others.length);

  const unions = unionsOfP(id).map(uid => {
    const u = S.unionById[uid];
    const partners = unionPartners(uid).filter(x => x !== id).map(x => S.personById[x]).filter(Boolean);
    const kids = unionChildren(uid).map(x => S.personById[x]).filter(Boolean);
    return { u, partners, kids };
  });
  // Parents come per union, not as one flat list: the ✎ besides them opens
  // that union, which is where a missing second parent or a missing sibling
  // is fixed — the repair a flat list quietly made unreachable.
  const parentUnions = (S.parentUnionsOf[id] || []).map(uid => ({
    u: S.unionById[uid],
    parents: unionPartners(uid).map(x => S.personById[x]).filter(Boolean),
  })).filter(x => x.u);
  const siblings = siblingsOfP(id).map(x => S.personById[x]).filter(Boolean);
  const rels = relsOf(id);
  const branches = branchesWithParents(p).map(bid => S.branchById[bid]).filter(Boolean);

  const personRow = (o, sub = '') => `
    <button class="relrow" data-person="${o.id}"><span class="relmain">
      ${avatarHtml(o, 'sm')}<span class="nm">${escapeHtml(o.name)}
      <span class="via">${escapeHtml(sub || lifespan(o))}</span></span></span></button>`;

  const body = `
    <div class="phead">
      ${avatarHtml(p, 'lg')}
      <div class="who">
        <div class="side">${escapeHtml([kin, lifespan(p)].filter(Boolean).join(' · '))}</div>
        ${p.birth_place ? `<div class="muted">${escapeHtml(p.birth_place)}</div>` : ''}
      </div>
      ${canEdit() ? `<button class="pinbtn ${p.pinned ? 'on' : ''}" data-pin
        title="${escapeHtml(t(p.pinned ? 'ui.unpin' : 'ui.pin'))}">★</button>` : ''}
    </div>

    ${factRows.length || registryRows.length || (p.tags || []).length || p.notes ? `
    <div class="card" style="margin-top:14px">
      <div class="kv">
        ${factRows.map(([icon, text]) => `<span class="k">${icon}</span><span>${escapeHtml(text)}</span>`).join('')}
        ${registryRows.map(({ f, value }) => {
          const shown = f.type === 'fuzzydate' ? formatFuzzy(value) : Array.isArray(value) ? value.join(', ') : value;
          const link = f.link && shown ? safeUrl(f.link(String(shown))) : '';
          const content = link
            ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(shown)}</a>`
            : escapeHtml(shown ?? '');
          return `<span class="k">${f.icon || '·'}</span><span>${content || `<span class="muted">–</span>`}${footnote(id, f.key)}</span>`;
        }).join('')}
      </div>
      ${(p.tags || []).length || otherViewsOf(id, 'tags').length ? `<div class="taglist" style="margin-top:10px">
        ${(p.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        ${otherViewsOf(id, 'tags').flatMap(({ who, value }) => String(value).split(',').map(x => x.trim()).filter(Boolean)
          .map(tag => `<span class="tag theirs" title="${escapeHtml(who)}">${escapeHtml(tag)}</span>`)).join('')}
      </div>` : ''}
      ${p.notes ? `<p class="muted" style="margin-top:10px;white-space:pre-wrap">${escapeHtml(p.notes)}</p>` : ''}
      ${footnote(id, 'notes')}
    </div>` : ''}

    <div class="card">
      <h3>${escapeHtml(t('card.family'))}</h3>
      ${parentUnions.map(({ u, parents }) => `
        <div class="lbl">${escapeHtml(t('card.parents'))}
          ${canEdit() ? `<button class="reledit" data-union="${u.id}" title="${escapeHtml(t('ui.edit'))}" style="float:right">✎</button>` : ''}
        </div>
        ${parents.map(o => personRow(o)).join('')}`).join('')}
      ${unions.map(({ u, partners, kids }) => `
        <div class="lbl" style="margin-top:10px">${escapeHtml(t('union.' + (u?.kind || 'unbekannt')))}${
          u?.started || u?.ended ? ` · ${escapeHtml([formatFuzzy(u.started), formatFuzzy(u.ended)].filter(Boolean).join('–'))}` : ''}
          ${canEdit() ? `<button class="reledit" data-union="${u.id}" title="${escapeHtml(t('ui.edit'))}" style="float:right">✎</button>` : ''}
        </div>
        ${partners.map(o => personRow(o)).join('')}
        ${kids.length ? `<div class="lbl" style="margin-top:6px">${escapeHtml(t('card.children'))}</div>${kids.map(o => personRow(o)).join('')}` : ''}
      `).join('')}
      ${siblings.length ? `<div class="lbl" style="margin-top:10px">${escapeHtml(t('card.siblings'))}</div>${siblings.map(o => personRow(o)).join('')}` : ''}
      ${!parentUnions.length && !unions.length && !siblings.length ? `<p class="muted">${escapeHtml(t('card.no_family'))}</p>` : ''}
      ${canEdit() ? `<button class="btn sm" data-addrel style="margin-top:10px">+ ${escapeHtml(t('card.add_relative'))}</button>` : ''}
    </div>

    ${rels.length || canEdit() ? `
    <div class="card">
      <h3>${escapeHtml(t('card.relationships'))}</h3>
      ${rels.map(r => {
        const o = otherEnd(r, id);
        if (!o) return '';
        return `<div class="relrow">
          <button class="relmain" data-person="${o.id}">
            <span class="kind">${relKind(r.kind).icon}</span>
            ${avatarHtml(o, 'sm')}<span class="nm">${escapeHtml(o.name)}
            <span class="via">${escapeHtml(r.label || t('rel.' + r.kind))}</span></span>
          </button>
          ${canEdit() ? `<button class="reledit" data-editrel="${r.id}" title="${escapeHtml(t('ui.edit'))}">✎</button>` : ''}
        </div>`;
      }).join('')}
      ${canEdit() ? `<button class="btn sm" data-connect style="margin-top:10px">+ ${escapeHtml(t('card.connect'))}</button>` : ''}
    </div>` : ''}

    ${storiesOf(id).length || canEdit() ? `
    <div class="card">
      <h3>${escapeHtml(t('card.stories'))}</h3>
      ${storiesOf(id).map(s => `<button class="relrow" data-openstory="${s.id}"><span class="relmain">
        <span class="kind">${escapeHtml(s.year != null ? String(s.year) : '·')}</span>
        <span class="nm">${escapeHtml(s.title)}
        <span class="via">${escapeHtml([formatFuzzy(s.date), s.place].filter(Boolean).join(' · '))}</span></span>
      </span></button>`).join('')}
      ${canEdit() ? `<button class="btn sm" data-newstory style="margin-top:10px">+ ${escapeHtml(t('story.new'))}</button>` : ''}
    </div>` : ''}

    ${branches.length ? `<div class="card"><h3>${escapeHtml(t('card.branches'))}</h3>
      <div class="taglist">${branches.map(b => `<span class="tag"><span class="dot" style="background:${
        escapeHtml(b.color)}"></span>${escapeHtml(b.name)}</span>`).join('')}</div></div>` : ''}

    <div class="btnrow" style="margin-top:14px">
      <button class="btn" data-treefrom>🌳 ${escapeHtml(t('card.from_here'))}</button>
      ${canEdit() ? `<button class="btn" data-edit>✎ ${escapeHtml(t('ui.edit'))}</button>` : ''}
    </div>`;

  openSheet(p.name, body, {
    onMount(root) {
      root.querySelectorAll('[data-person]').forEach(btn => {
        btn.onclick = () => openPerson(Number(btn.dataset.person));
      });
      root.querySelector('[data-edit]')?.addEventListener('click', () => openPersonForm(id));
      root.querySelector('[data-addrel]')?.addEventListener('click', () => openQuickAdd({ relativeOf: id }));
      root.querySelector('[data-connect]')?.addEventListener('click', () => openRelationshipForm(id));
      root.querySelectorAll('[data-editrel]').forEach(btn => {
        const rel = rels.find(r => r.id === Number(btn.dataset.editrel));
        btn.onclick = () => openRelationshipForm(id, rel);
      });
      root.querySelectorAll('[data-union]').forEach(btn => {
        btn.onclick = e => { e.stopPropagation(); openUnionForm(Number(btn.dataset.union)); };
      });
      root.querySelector('[data-treefrom]').onclick = () => { closeSheet(); onTreeFrom(id); };
      // views.js imports ui.js, so the story sheets are reached dynamically.
      root.querySelectorAll('[data-openstory]').forEach(btn => {
        btn.onclick = () => import('./views.js').then(m => m.openStory(Number(btn.dataset.openstory)));
      });
      root.querySelector('[data-newstory]')?.addEventListener('click', () =>
        import('./views.js').then(m => m.openStoryForm(null, [id])));
      const pin = root.querySelector('[data-pin]');
      if (pin) {
        pin.onclick = async () => {
          try {
            await api.put(`/api/persons/${id}`, { pinned: !p.pinned });
            await refresh();
            openPerson(id);
          } catch (err) { toast(err.message); }
        };
      }
    },
  });
}

// ------------------------------------------------------------------ person form

/**
 * Everything but the structural pieces is drawn from the registry — a new
 * field is one entry in fields.js and nothing here. Consecutive half-width
 * fields share a row. Shared by both forms, so the quick add and the full
 * edit can never drift apart on what a field looks like.
 */
function section(which, p) {
  const out = [];
  for (const f of fieldsIn(which)) {
    const html = fieldHtml(f, p ? p[f.key] : undefined);
    const last = out[out.length - 1];
    if (f.half && last?.open) { last.html += html; last.open = false; }
    else out.push({ html, open: Boolean(f.half), pair: Boolean(f.half) });
  }
  return out.map(row => (row.pair ? `<div class="two">${row.html}</div>` : row.html)).join('');
}

/** A date and the place it happened, which is how both of them are recorded. */
function lifeEventHtml(which, p) {
  return `<div class="lifeevent">
    ${fuzzyDateHtml(which, p?.[which] || '', { label: t('p.' + which) })}
    <label class="field"><span>${escapeHtml(t(`p.${which}_place`))}</span>
      <input data-f="${which}_place" value="${escapeHtml(p?.[`${which}_place`] || '')}" autocomplete="off"></label>
  </div>`;
}

export function openPersonForm(id) {
  const p = id ? S.personById[id] : null;

  const branchBoxes = treeOrder().map(({ branch: b }) => `<label class="check">
    <input type="checkbox" value="${b.id}" ${p?.branches?.includes(b.id) ? 'checked' : ''}>
    <span class="tag"><span class="dot" style="background:${escapeHtml(b.color)}"></span>${
      branchIndent(b)}${escapeHtml(b.name)}</span></label>`).join('');

  const body = `
    <label class="field"><span>${escapeHtml(t('ui.name'))}</span>
      <input data-f="name" value="${escapeHtml(p?.name || '')}" placeholder="${escapeHtml(t('form.name_ph'))}"></label>
    <label class="field"><span>${escapeHtml(t('p.sex'))}</span>
      <select data-f="sex">
        <option value="" ${!p?.sex ? 'selected' : ''}>–</option>
        <option value="f" ${p?.sex === 'f' ? 'selected' : ''}>${escapeHtml(t('sex.f'))}</option>
        <option value="m" ${p?.sex === 'm' ? 'selected' : ''}>${escapeHtml(t('sex.m'))}</option>
      </select></label>

    ${lifeEventHtml('birth', p)}
    ${lifeEventHtml('death', p)}

    ${section('notiz', p)}
    ${section('kopf', p)}

    ${S.branches.length ? `<div class="lbl" style="margin-top:20px">${escapeHtml(t('card.branches'))}</div>
    <div class="checkscroll" data-branches>${branchBoxes}</div>` : ''}

    ${SECTIONS.filter(sec => sec.label).map(sec => `
      <div class="lbl" style="margin-top:22px">${escapeHtml(t(sec.label))}</div>
      ${section(sec.id, p)}`).join('')}

    <button class="btn primary wide" data-save style="margin-top:22px">${escapeHtml(t('ui.save'))}</button>
    ${p ? `<button class="btn danger wide" data-delete style="margin-top:10px">${escapeHtml(t('form.delete_person'))}</button>` : ''}
  `;

  openSheet(p ? t('form.edit_person', { name: p.name }) : t('form.new_person'), body, {
    onMount(root) {
      mountFuzzyDates(root);
      // Coordinates ride along with the place text. Editing the text by hand
      // drops them — they would otherwise still point at the old place; only
      // picking a suggestion (or the admin backfill) sets them.
      const coords = {
        birth: { lat: p?.birth_lat ?? null, lon: p?.birth_lon ?? null },
        death: { lat: p?.death_lat ?? null, lon: p?.death_lon ?? null },
      };
      import('./geo.js').then(geo => {
        for (const which of ['birth', 'death']) {
          geo.attachPlacePicker(root.querySelector(`[data-f="${which}_place"]`), {
            onPick: hit => { coords[which] = { lat: hit?.lat ?? null, lon: hit?.lon ?? null }; },
          });
        }
      });

      root.querySelector('[data-save]').onclick = async () => {
        const payload = {
          name: val(root, 'name').trim(),
          sex: val(root, 'sex'),
          birth: val(root, 'birth').trim(),
          birth_place: val(root, 'birth_place').trim(),
          birth_lat: coords.birth.lat, birth_lon: coords.birth.lon,
          death: val(root, 'death').trim(),
          death_place: val(root, 'death_place').trim(),
          death_lat: coords.death.lat, death_lon: coords.death.lon,
          ...(root.querySelector('[data-branches]') ? { branches: checked(root, '[data-branches] input') } : {}),
          ...readFields(root),
        };
        if (!payload.name) return toast(t('form.name_missing'));
        try {
          if (p) await api.put(`/api/persons/${p.id}`, payload);
          else await api.post('/api/persons', payload);
          await refresh();
          toast(t('form.saved'));
          if (p) openPerson(p.id); else closeSheet();
        } catch (err) { toast(err.message); }
      };

      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(t('form.delete_confirm', { name: p.name }))) return;
        try {
          await api.del(`/api/persons/${p.id}`);
          await refresh();
          closeSheet();
          toast(t('form.deleted'));
        } catch (err) { toast(err.message); }
      });
    },
  });
}

// ------------------------------------------------------------------ quick add

/**
 * Add a person the way you think: who are they, and where do they hang in
 * the tree. One request — the connection travels with the person.
 */
/**
 * The relation block both quick-add modes share: what they are to the
 * anchor, to whom — and what the relation itself is like. Picking "Partner"
 * asks which kind of partnership; picking "Kind" asks how they arrived.
 * Those lived only in the union form before, which meant every marriage was
 * created as "unbekannt" and corrected afterwards, if anyone found the form.
 */
function relationBlockHtml() {
  return `
    <div class="lbl" style="margin-top:20px">${escapeHtml(t('add.how'))}</div>
    <div class="linkrow">
      <select data-f="how">
        <option value="partner">${escapeHtml(t('add.rel_partner'))}</option>
        <option value="child_of_person">${escapeHtml(t('add.rel_child'))}</option>
        <option value="parent_of">${escapeHtml(t('add.rel_parent'))}</option>
        <option value="">${escapeHtml(t('add.rel_none'))}</option>
      </select>
      <div class="ppick" data-anchor></div>
    </div>
    <label class="field" data-how-kind><span>${escapeHtml(t('union.kind'))}</span>
      <select data-f="union_kind">${UNION_KINDS.map(k =>
    `<option value="${k}">${escapeHtml(t('union.' + k))}</option>`).join('')}</select></label>
    <label class="field" data-how-role hidden><span>${escapeHtml(t('add.child_role'))}</span>
      <select data-f="child_role">${CHILD_ROLES.map(r =>
    `<option value="${r}">${escapeHtml(t('role.' + r))}</option>`).join('')}</select></label>`;
}

/** Show the controls the chosen relation actually needs, hide the rest. */
function wireRelationBlock(root) {
  const how = root.querySelector('[data-f="how"]');
  const sync = () => {
    root.querySelector('[data-how-kind]').hidden = !['partner', 'parent_of'].includes(how.value);
    root.querySelector('[data-how-role]').hidden = !how.value.startsWith('child');
  };
  how.addEventListener('change', sync);
  sync();
}

/** The connect payload the relation block currently describes, or null. */
function readRelationBlock(root, picker) {
  const how = val(root, 'how');
  if (!how || !picker.value) return null;
  return {
    type: how, id: picker.value,
    ...(['partner', 'parent_of'].includes(how) ? { kind: val(root, 'union_kind') } : {}),
    ...(how.startsWith('child') ? { role: val(root, 'child_role') } : {}),
  };
}

export function openQuickAdd({ relativeOf = null } = {}) {
  const anchor = relativeOf ?? S.probandId;
  const body = `
    <div class="seg" data-mode role="tablist">
      <button class="on" data-seg="new">${escapeHtml(t('add.mode_new'))}</button>
      <button data-seg="link">${escapeHtml(t('add.mode_link'))}</button>
    </div>

    <div data-pane="new">
    <label class="field"><span>${escapeHtml(t('ui.name'))}</span>
      <input data-f="name" placeholder="${escapeHtml(t('form.name_ph'))}" autocomplete="off"></label>
    <label class="field"><span>${escapeHtml(t('p.sex'))}</span>
      <select data-f="sex"><option value="">–</option>
        <option value="f">${escapeHtml(t('sex.f'))}</option>
        <option value="m">${escapeHtml(t('sex.m'))}</option></select></label>

    ${lifeEventHtml('birth', null)}
    ${lifeEventHtml('death', null)}
    </div>

    <div data-pane="link" hidden>
      <div class="lbl">${escapeHtml(t('add.link_who'))}</div>
      <div class="ppick" data-linkperson></div>
      <p class="muted" style="margin-top:8px">${escapeHtml(t('add.link_hint'))}</p>
    </div>

    ${relationBlockHtml()}

    <details class="more" data-more-fields>
      <summary>${escapeHtml(t('add.more'))}</summary>
      ${section('notiz', null)}
      ${section('kopf', null)}
      ${S.branches.length ? `<div class="lbl" style="margin-top:18px">${escapeHtml(t('card.branches'))}</div>
      <div class="checkscroll" data-branches>${treeOrder().map(({ branch: b }) => `<label class="check">
        <input type="checkbox" value="${b.id}">
        <span class="tag"><span class="dot" style="background:${escapeHtml(b.color)}"></span>${
  branchIndent(b)}${escapeHtml(b.name)}</span></label>`).join('')}</div>` : ''}
      ${SECTIONS.filter(sec => sec.label).map(sec => `
        <div class="lbl" style="margin-top:20px">${escapeHtml(t(sec.label))}</div>
        ${section(sec.id, null)}`).join('')}
    </details>

    <button class="btn primary wide" data-save style="margin-top:22px">${escapeHtml(t('add.create'))}</button>
    <button class="btn wide" data-more style="margin-top:10px">${escapeHtml(t('add.create_more'))}</button>
    <div class="muted" data-added style="margin-top:10px"></div>`;

  openSheet(t('add.title'), body, {
    onMount(root) {
      mountFuzzyDates(root);
      const picker = personPicker(root.querySelector('[data-anchor]'), { selected: anchor });
      const linkPicker = personPicker(root.querySelector('[data-linkperson]'), {
        placeholder: t('add.link_ph'),
      });
      wireRelationBlock(root);

      // The two modes: type somebody in, or place somebody already typed in.
      let mode = 'new';
      const segs = root.querySelectorAll('[data-mode] [data-seg]');
      segs.forEach(btn => {
        btn.onclick = () => {
          mode = btn.dataset.seg;
          segs.forEach(b => b.classList.toggle('on', b === btn));
          root.querySelector('[data-pane="new"]').hidden = mode !== 'new';
          root.querySelector('[data-pane="link"]').hidden = mode !== 'link';
          // "Not related" creates a loose person; a *link* with no relation
          // would do nothing at all, so the option leaves with the mode.
          const none = root.querySelector('[data-f="how"] option[value=""]');
          none.hidden = mode === 'link';
          if (mode === 'link' && !val(root, 'how')) {
            root.querySelector('[data-f="how"]').value = 'partner';
            root.querySelector('[data-f="how"]').dispatchEvent(new Event('change'));
          }
          root.querySelector('[data-more-fields]').hidden = mode === 'link';
          root.querySelector('[data-more]').hidden = mode === 'link';
          root.querySelector('[data-save]').textContent = t(mode === 'link' ? 'add.link_go' : 'add.create');
        };
      });

      const coords = { birth: { lat: null, lon: null }, death: { lat: null, lon: null } };
      import('./geo.js').then(geo => {
        for (const which of ['birth', 'death']) {
          geo.attachPlacePicker(root.querySelector(`[data-f="${which}_place"]`), {
            onPick: hit => { coords[which] = { lat: hit?.lat ?? null, lon: hit?.lon ?? null }; },
          });
        }
      });
      root.querySelector('[data-f="name"]').focus();

      const save = async () => {
        const connect = readRelationBlock(root, picker);
        if (mode === 'link') {
          const who = linkPicker.value;
          if (!who) { toast(t('add.link_missing')); return null; }
          if (!connect) { toast(t('add.link_missing')); return null; }
          if (who === connect.id) { toast(t('add.link_self')); return null; }
          try {
            await api.post(`/api/persons/${who}/connect`, connect);
            await refresh();
            return who;
          } catch (err) { toast(err.message); return null; }
        }
        const name = val(root, 'name').trim();
        if (!name) { toast(t('form.name_missing')); return null; }
        const payload = {
          name,
          sex: val(root, 'sex'),
          birth: val(root, 'birth').trim(),
          birth_place: val(root, 'birth_place').trim(),
          birth_lat: coords.birth.lat, birth_lon: coords.birth.lon,
          death: val(root, 'death').trim(),
          death_place: val(root, 'death_place').trim(),
          death_lat: coords.death.lat, death_lon: coords.death.lon,
          ...(root.querySelector('[data-branches]') ? { branches: checked(root, '[data-branches] input') } : {}),
          ...readFields(root),
          ...(connect ? { connect } : {}),
        };
        try {
          const out = await api.post('/api/persons', payload);
          await refresh();
          return out.id;
        } catch (err) { toast(err.message); return null; }
      };

      root.querySelector('[data-save]').onclick = async () => {
        const id = await save();
        if (id) { closeSheet(); openPerson(id); }
      };
      // Add-another keeps what a run of siblings shares — the relation, the
      // branches, the places — and clears only what is about one person.
      // Retyping the same village forty times is the hassle, not the typing.
      root.querySelector('[data-more]').onclick = async () => {
        const name = val(root, 'name').trim();
        const id = await save();
        if (!id) return;
        root.querySelector('[data-added]').textContent = `✓ ${name}`;
        root.querySelector('[data-f="name"]').value = '';
        root.querySelector('[data-f="sex"]').value = '';
        for (const box of root.querySelectorAll('[data-fdate]')) {
          box.querySelectorAll('[data-fd="y"], [data-fd="raw"]').forEach(el => { el.value = ''; });
          box.querySelectorAll('select[data-fd="m"], select[data-fd="d"]').forEach(el => { el.value = ''; });
          box.querySelector('[data-fd="kind"]').dispatchEvent(new Event('change'));
        }
        root.querySelector('[data-f="name"]').focus();
      };
    },
  });
}

// ------------------------------------------------------------------ union form

export function openUnionForm(unionId) {
  const u = S.unionById[unionId];
  if (!u) return;
  const partners = unionPartners(unionId).map(x => S.personById[x]).filter(Boolean);
  const kids = unionChildren(unionId).map(x => S.personById[x]).filter(Boolean);

  const body = `
    <p class="muted">${partners.map(o => escapeHtml(o.name)).join(' & ')}</p>
    <label class="field"><span>${escapeHtml(t('union.kind'))}</span>
      <select data-f="kind">${UNION_KINDS.map(k =>
        `<option value="${k}" ${u.kind === k ? 'selected' : ''}>${escapeHtml(t('union.' + k))}</option>`).join('')}</select></label>
    ${fuzzyDateHtml('started', u.started || '', { label: t('union.started') })}
    ${fuzzyDateHtml('ended', u.ended || '', { label: t('union.ended') })}
    <label class="field"><span>${escapeHtml(t('union.note'))}</span>
      <input data-f="note" value="${escapeHtml(u.note || '')}"></label>

    ${partners.length < 2 ? `
    <div class="lbl" style="margin-top:18px">${escapeHtml(t('union.add_partner'))}</div>
    <div class="linkrow">
      <div class="ppick" data-newpartner></div>
      <button class="btn sm" data-addpartner>+</button>
    </div>` : ''}

    <div class="lbl" style="margin-top:18px">${escapeHtml(t('card.children'))}</div>
    ${kids.map(o => `<div class="relrow"><span class="relmain">${avatarHtml(o, 'sm')}
      <span class="nm">${escapeHtml(o.name)}</span></span>
      <button class="reledit" data-removechild="${o.id}" title="${escapeHtml(t('ui.delete'))}">✕</button></div>`).join('')}
    <div class="linkrow" style="margin-top:8px">
      <div class="ppick" data-newchild></div>
      <select data-f="childrole">${CHILD_ROLES.map(r => `<option value="${r}">${escapeHtml(t('role.' + r))}</option>`).join('')}</select>
      <button class="btn sm" data-addchild>+</button>
    </div>

    <button class="btn primary wide" data-save style="margin-top:22px">${escapeHtml(t('ui.save'))}</button>
    <button class="btn danger wide" data-delete style="margin-top:10px">${escapeHtml(t('union.delete'))}</button>`;

  openSheet(t('union.title'), body, {
    onMount(root) {
      mountFuzzyDates(root);
      const exclude = [...unionPartners(unionId), ...unionChildren(unionId)];
      const picker = personPicker(root.querySelector('[data-newchild]'), { exclude });
      const partnerHost = root.querySelector('[data-newpartner]');
      if (partnerHost) {
        const partnerPicker = personPicker(partnerHost, { exclude });
        root.querySelector('[data-addpartner]').onclick = async () => {
          if (!partnerPicker.value) return;
          try {
            await api.post(`/api/unions/${unionId}/partners`, { person_id: partnerPicker.value });
            await refresh();
            openUnionForm(unionId);
          } catch (err) { toast(err.message); }
        };
      }

      root.querySelector('[data-save]').onclick = async () => {
        try {
          await api.put(`/api/unions/${unionId}`, {
            kind: val(root, 'kind'), started: val(root, 'started').trim(),
            ended: val(root, 'ended').trim(), note: val(root, 'note'),
          });
          await refresh();
          toast(t('form.saved'));
          closeSheet();
        } catch (err) { toast(err.message); }
      };
      root.querySelector('[data-addchild]').onclick = async () => {
        if (!picker.value) return;
        try {
          await api.post(`/api/unions/${unionId}/children`, { child_id: picker.value, role: val(root, 'childrole') });
          await refresh();
          openUnionForm(unionId);
        } catch (err) { toast(err.message); }
      };
      root.querySelectorAll('[data-removechild]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await api.del(`/api/unions/${unionId}/children/${btn.dataset.removechild}`);
            await refresh();
            openUnionForm(unionId);
          } catch (err) { toast(err.message); }
        };
      });
      root.querySelector('[data-delete]').onclick = async () => {
        if (!confirm(t('ui.confirm_delete'))) return;
        try {
          await api.del(`/api/unions/${unionId}`);
          await refresh();
          closeSheet();
          toast(t('form.deleted'));
        } catch (err) { toast(err.message); }
      };
    },
  });
}

// ------------------------------------------------------------------ relationship form

/** The free-form described link: who, what kind, and what it entails. */
export function openRelationshipForm(personId, rel = null) {
  const otherId = rel ? (rel.a_id === personId ? rel.b_id : rel.a_id) : null;
  const body = `
    <div class="lbl">${escapeHtml(t('relf.with'))}</div>
    <div class="ppick" data-other></div>
    <label class="field"><span>${escapeHtml(t('relf.kind'))}</span>
      <select data-f="kind">${REL_KINDS.map(k =>
        `<option value="${k.id}" ${rel?.kind === k.id ? 'selected' : ''}>${k.icon} ${escapeHtml(t('rel.' + k.id))}</option>`).join('')}</select></label>
    <label class="field"><span>${escapeHtml(t('relf.label'))}</span>
      <textarea data-f="label" placeholder="${escapeHtml(t('relf.label_ph'))}">${escapeHtml(rel?.label || '')}</textarea></label>
    <button class="btn primary wide" data-save style="margin-top:18px">${escapeHtml(t('ui.save'))}</button>
    ${rel ? `<button class="btn danger wide" data-delete style="margin-top:10px">${escapeHtml(t('relf.delete'))}</button>` : ''}`;

  openSheet(t('relf.title'), body, {
    subtitle: S.personById[personId]?.name || '',
    onMount(root) {
      const picker = personPicker(root.querySelector('[data-other]'), {
        selected: otherId, exclude: [personId], locked: Boolean(rel),
      });
      root.querySelector('[data-save]').onclick = async () => {
        if (!picker.value) return toast(t('form.name_missing'));
        try {
          await api.post('/api/relationships', {
            a_id: personId, b_id: picker.value,
            kind: val(root, 'kind'), label: val(root, 'label').trim(),
          });
          await refresh();
          toast(t('form.saved'));
          openPerson(personId);
        } catch (err) { toast(err.message); }
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        try {
          await api.del(`/api/relationships/${rel.id}`);
          await refresh();
          openPerson(personId);
        } catch (err) { toast(err.message); }
      });
    },
  });
}

// ------------------------------------------------------------------ branches

export function openBranches() {
  const rows = treeOrder().map(({ branch: b, depth }) => `
    <div class="relrow">
      <span class="relmain">
        <span class="dot" style="width:12px;height:12px;border-radius:50%;background:${escapeHtml(b.color)};margin-left:${depth * 14}px"></span>
        <span class="nm">${escapeHtml(b.emoji ? b.emoji + ' ' : '')}${escapeHtml(b.name)}</span>
      </span>
      ${canEdit() ? `<button class="reledit" data-editbranch="${b.id}">✎</button>` : ''}
    </div>`).join('');

  const body = `
    ${rows || `<p class="muted">${escapeHtml(t('br.none_yet'))}</p>`}
    ${canEdit() ? `<button class="btn primary wide" data-new style="margin-top:16px">+ ${escapeHtml(t('br.new'))}</button>` : ''}`;

  openSheet(t('br.title'), body, {
    onMount(root) {
      root.querySelector('[data-new]')?.addEventListener('click', () => openBranchForm());
      root.querySelectorAll('[data-editbranch]').forEach(btn => {
        btn.onclick = () => openBranchForm(Number(btn.dataset.editbranch));
      });
    },
  });
}

export function openBranchForm(id = null) {
  const b = id ? S.branchById[id] : null;
  const color = b?.color || suggestBranchColor();
  const parentOptions = `<option value="">${escapeHtml(t('br.parent_none'))}</option>`
    + treeOrder().filter(({ branch }) => branch.id !== id)
      .map(({ branch: x, depth }) => `<option value="${x.id}" ${b?.parent_id === x.id ? 'selected' : ''}>${
        ' '.repeat(depth * 2)}${escapeHtml(x.name)}</option>`).join('');

  const body = `
    <label class="field"><span>${escapeHtml(t('ui.name'))}</span>
      <input data-f="name" value="${escapeHtml(b?.name || '')}" placeholder="${escapeHtml(t('br.name_ph'))}"></label>
    <div class="two">
      <label class="field"><span>${escapeHtml(t('br.color'))}</span>
        <input data-f="color" type="color" value="${escapeHtml(color)}" style="height:44px;padding:4px"></label>
      <label class="field"><span>Emoji</span>
        <input data-f="emoji" value="${escapeHtml(b?.emoji || '')}" maxlength="4"></label>
    </div>
    <label class="field"><span>${escapeHtml(t('br.parent'))}</span>
      <select data-f="parent">${parentOptions}</select></label>
    <button class="btn primary wide" data-save style="margin-top:18px">${escapeHtml(t('ui.save'))}</button>
    ${b ? `<button class="btn danger wide" data-delete style="margin-top:10px">${escapeHtml(t('ui.delete'))}</button>` : ''}`;

  openSheet(b ? b.name : t('br.new'), body, {
    onMount(root) {
      root.querySelector('[data-save]').onclick = async () => {
        const payload = {
          name: val(root, 'name').trim(), color: val(root, 'color'),
          emoji: val(root, 'emoji').trim(), parent_id: Number(val(root, 'parent')) || null,
        };
        if (!payload.name) return toast(t('form.name_missing'));
        try {
          if (b) await api.put(`/api/branches/${b.id}`, payload);
          else await api.post('/api/branches', payload);
          await refresh();
          openBranches();
        } catch (err) { toast(err.message); }
      };
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(t('br.delete_confirm', { name: b.name }))) return;
        try {
          await api.del(`/api/branches/${b.id}`);
          await refresh();
          openBranches();
        } catch (err) { toast(err.message); }
      });
    },
  });
}

// ------------------------------------------------------------------ legend

/**
 * What the lines mean. Drawn as little SVG samples rather than described in
 * words, because that is the question being asked — and they take their
 * colours from the same tokens the canvas reads, so the legend can never
 * drift away from the chart.
 */
export function openLegend() {
  const sample = (inner, w = 60) => `<svg width="${w}" height="26" viewBox="0 0 ${w} 26"
    style="flex:none" aria-hidden="true">${inner}</svg>`;
  const dot = (cx, cy = 13, fill = 'var(--ungrouped)') =>
    `<circle cx="${cx}" cy="${cy}" r="6" fill="${fill}"/>`;

  const rows = [
    [sample(`${dot(10)}<line x1="16" y1="13" x2="44" y2="13"
        stroke="var(--love)" stroke-width="3"/>${dot(50)}`), t('leg.married')],
    [sample(`${dot(10)}<line x1="16" y1="13" x2="44" y2="13"
        stroke="var(--love)" stroke-width="3" stroke-dasharray="7 5"/>${dot(50)}`), t('leg.partners')],
    [sample(`<path d="M30 1 V7 H12 V15 M30 7 H48 V15" fill="none"
        stroke="var(--family)" stroke-width="2"/>${dot(12, 20)}${dot(48, 20)}`), t('leg.children')],
    // Both drops at once, because the dashed one only means anything beside
    // the plain one it is being told apart from.
    [sample(`<path d="M30 1 V7 H12 V15" fill="none" stroke="var(--family)" stroke-width="2"/>
      <path d="M30 7 H48 V15" fill="none" stroke="var(--family)" stroke-width="2"
        stroke-dasharray="4 3"/>${dot(12, 20)}${dot(48, 20)}`), t('leg.adopted')],
    [sample(`<line x1="6" y1="20" x2="54" y2="6" stroke="var(--line-2)"
        stroke-width="2" stroke-dasharray="2 5"/>`), t('leg.described')],
    // The living wear the paper-coloured edge, the dead a drawn ring; side
    // by side is the only way that difference is a difference.
    [sample(`<circle cx="16" cy="13" r="7" fill="var(--ungrouped)" stroke="var(--paper)" stroke-width="2"/>
      <circle cx="44" cy="13" r="7" fill="var(--ungrouped)" stroke="var(--ink-3)" stroke-width="2.5"/>`),
    t('leg.died')],
    [sample(`<circle cx="30" cy="13" r="8" fill="var(--ink)"/>`), t('leg.proband')],
  ];

  openSheet(t('leg.title'), `
    <div class="stack">
      ${rows.map(([svg, text]) => `<div class="rowline">${svg}
        <span style="font-size:14px">${escapeHtml(text)}</span></div>`).join('')}
    </div>
    <p class="muted" style="margin-top:16px">${escapeHtml(t('leg.hint'))}</p>`);
}

// ------------------------------------------------------------------ settings

export function setTheme(mode) {
  localStorage.setItem('am-theme', mode);
  if (mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  window.dispatchEvent(new Event('am-theme'));
}

export function openSettings({ onLogout } = {}) {
  const theme = localStorage.getItem('am-theme') || 'auto';
  const body = `
    <div class="card">
      <h3>${escapeHtml(t('ui.language'))}</h3>
      <div class="seg" data-langs>${LANGS.map(l =>
        `<button data-lang="${l}" class="${getLang() === l ? 'on' : ''}">${escapeHtml(LANG_NAMES[l])}</button>`).join('')}</div>
    </div>
    <div class="card">
      <h3>${escapeHtml(t('set.theme'))}</h3>
      <div class="seg" data-theme>
        ${['auto', 'light', 'dark'].map(m =>
          `<button data-mode="${m}" class="${theme === m ? 'on' : ''}">${escapeHtml(t('theme.' + m))}</button>`).join('')}
      </div>
    </div>
    <div class="card">
      <h3>${escapeHtml(t('set.password'))}</h3>
      <label class="field"><span>${escapeHtml(t('set.pw_current'))}</span>
        <input data-f="pw0" type="password" autocomplete="current-password"></label>
      <label class="field"><span>${escapeHtml(t('set.pw_new'))}</span>
        <input data-f="pw1" type="password" autocomplete="new-password"></label>
      <button class="btn wide" data-pw style="margin-top:10px">${escapeHtml(t('ui.save'))}</button>
    </div>
    ${isAdmin() ? `<a class="btn wide" href="/admin" style="margin-top:12px;display:flex;text-decoration:none">${escapeHtml(t('set.admin'))}</a>` : ''}
    <button class="btn wide" data-logout style="margin-top:12px">${escapeHtml(t('ui.logout'))}</button>
    <p class="muted" style="margin-top:14px;text-align:center">${escapeHtml(buildLabel())}</p>`;

  openSheet(t('ui.settings'), body, {
    onMount(root) {
      root.querySelectorAll('[data-lang]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await api.post('/api/me', { lang: btn.dataset.lang });
            location.reload();          // every string on screen changes — a reload is the honest redraw
          } catch (err) { toast(err.message); }
        };
      });
      root.querySelectorAll('[data-theme] button').forEach(btn => {
        btn.onclick = () => {
          setTheme(btn.dataset.mode);
          root.querySelectorAll('[data-theme] button').forEach(x => x.classList.toggle('on', x === btn));
        };
      });
      root.querySelector('[data-pw]').onclick = async () => {
        try {
          await api.post('/api/password', { current: val(root, 'pw0'), next: val(root, 'pw1') });
          toast(t('set.pw_changed'));
          setTimeout(() => location.reload(), 1200);
        } catch (err) { toast(err.message); }
      };
      root.querySelector('[data-logout]').onclick = onLogout;
    },
  });
}
