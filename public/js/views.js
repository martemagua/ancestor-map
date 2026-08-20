// The Menschen / Geschichten / Orte tab bodies. Each writes into its own
// container and wires handlers; peopleList() in store.js is the only thing
// that decides who is in the list and in what order.
import { api } from './api.js';
import {
  S, SORTS, GROUPS, QUICK, peopleList, savePeopleView, escapeHtml,
  branchesWithParents, lighten, lifespan, kinLabel, storyKind, STORY_KINDS, todayISO,
} from './store.js';
import { avatarHtml, openPerson, openSheet, closeSheet, toast, refreshNow, canEdit, personPicker } from './ui.js';
import { formatFuzzy } from './fuzzydate.js';
import { t } from './i18n.js';

const $ = sel => document.querySelector(sel);

let onShowOnMap = () => {};
export const bindShowOnMap = fn => { onShowOnMap = fn; };

// ------------------------------------------------------------------ people

export function renderPeople() {
  renderControls();
  const list = peopleList();
  $('#people-count').textContent = list.length;
  const host = $('#people-list');

  if (!list.length) {
    const filtered = S.quick.size || S.search;
    host.innerHTML = `<div class="empty"><span class="big">🌳</span>
      <div>${escapeHtml(filtered ? t('list.empty') : t('list.nobody'))}</div>
      ${filtered ? `<button class="btn sm" data-resetfilters>${escapeHtml(t('list.reset'))}</button>`
        : canEdit() ? `<button class="btn sm" data-addfirst>${escapeHtml(t('list.add_first'))}</button>` : ''}
    </div>`;
    host.querySelector('[data-resetfilters]')?.addEventListener('click', () => {
      S.quick.clear(); S.search = '';
      const search = $('#search');
      if (search) search.value = '';
      savePeopleView();
      renderPeople();
    });
    host.querySelector('[data-addfirst]')?.addEventListener('click', async () => {
      const { openQuickAdd } = await import('./ui.js');
      openQuickAdd({});
    });
    return;
  }

  host.innerHTML = groupsFor(list).map(({ head, color, people }) => `
    ${head !== null ? `<div class="grouphead">${color ? `<span class="dot" style="background:${escapeHtml(color)}"></span>` : ''}${
      escapeHtml(head)}<span class="n">${people.length}</span></div>` : ''}
    ${people.map(row).join('')}`).join('');

  host.querySelectorAll('.prow').forEach(el => {
    el.onclick = () => openPerson(Number(el.dataset.id));
  });
}

function row(p) {
  const kin = kinLabel(p.id);
  const sub = [kin, p.birth_place].filter(Boolean).join(' · ');
  return `<button class="prow" data-id="${p.id}">
    ${avatarHtml(p)}
    <span class="meta">
      <span class="nm">${p.pinned ? '★ ' : ''}${escapeHtml(p.name)}</span>
      <span class="sec">${escapeHtml(sub)}</span>
    </span>
    <span class="stale">${escapeHtml(lifespan(p))}</span>
  </button>`;
}

/** Pinned people stand above every grouping and every sort. */
function groupsFor(list) {
  const pinned = list.filter(p => p.pinned);
  const rest = list.filter(p => !p.pinned);
  const out = pinned.length ? [{ head: `★ ${t('quick.pinned')}`, color: null, people: pinned }] : [];

  if (S.groupBy === 'alpha') {
    const buckets = new Map();
    for (const p of rest) {
      const letter = (p.name[0] || '#').toUpperCase();
      if (!buckets.has(letter)) buckets.set(letter, []);
      buckets.get(letter).push(p);
    }
    for (const [letter, people] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push({ head: letter, color: null, people });
    }
    return out;
  }

  if (S.groupBy === 'branch') {
    const seen = new Set();
    for (const b of S.branches) {
      const people = rest.filter(p => !seen.has(p.id) && branchesWithParents(p)[0] === b.id);
      if (!people.length) continue;
      for (const p of people) seen.add(p.id);
      const depth = b.parent_id ? 1 : 0;
      out.push({ head: (b.emoji ? b.emoji + ' ' : '') + b.name, color: depth ? lighten(b.color) : b.color, people });
    }
    const leftovers = rest.filter(p => !seen.has(p.id));
    if (leftovers.length) out.push({ head: t('quick.nobranch'), color: 'var(--ungrouped)', people: leftovers });
    return out;
  }

  out.push({ head: pinned.length ? '' : null, color: null, people: rest });
  return out;
}

function renderControls() {
  const host = $('#people-controls');
  host.innerHTML = `
    <div class="seg">${SORTS.map(s =>
      `<button data-sort="${s.id}" class="${S.sortBy === s.id ? 'on' : ''}">${escapeHtml(s.label())}</button>`).join('')}</div>
    <div class="seg">${GROUPS.map(g =>
      `<button data-group="${g.id}" class="${S.groupBy === g.id ? 'on' : ''}">${escapeHtml(g.label())}</button>`).join('')}</div>
    ${QUICK.map(q =>
      `<button class="chip sm ${S.quick.has(q.id) ? 'on' : ''}" data-quick="${q.id}">${escapeHtml(q.label())}</button>`).join('')}`;

  host.querySelectorAll('[data-sort]').forEach(b => {
    b.onclick = () => { S.sortBy = b.dataset.sort; savePeopleView(); renderPeople(); };
  });
  host.querySelectorAll('[data-group]').forEach(b => {
    b.onclick = () => { S.groupBy = b.dataset.group; savePeopleView(); renderPeople(); };
  });
  host.querySelectorAll('[data-quick]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.quick;
      S.quick.has(id) ? S.quick.delete(id) : S.quick.add(id);
      savePeopleView();
      renderPeople();
    };
  });
}

// ------------------------------------------------------------------ stories

export function renderStories() {
  const host = $('#stories-list');
  const stories = S.stories || [];

  const header = canEdit()
    ? `<button class="btn primary wide" data-newstory style="margin-top:14px">+ ${escapeHtml(t('story.new'))}</button>` : '';

  if (!stories.length) {
    host.innerHTML = `${header}<div class="empty"><span class="big">🕯️</span>
      <div>${escapeHtml(t('story.empty'))}</div></div>`;
    host.querySelector('[data-newstory]')?.addEventListener('click', () => openStoryForm());
    return;
  }

  // Grouped by year, newest first — the shape a family chronicle reads in.
  const groups = new Map();
  for (const s of stories) {
    const year = s.date_year ?? t('story.undated');
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(s);
  }

  host.innerHTML = header + [...groups.entries()].map(([year, list]) => `
    <div class="grouphead">${escapeHtml(String(year))}<span class="n">${list.length}</span></div>
    ${list.map(s => `
      <button class="prow" data-story="${s.id}">
        <span class="avatar" style="background:var(--sunk);color:var(--ink)">${storyKind(s.kind).icon}</span>
        <span class="meta">
          <span class="nm">${escapeHtml(s.title)}</span>
          <span class="sec">${escapeHtml([formatFuzzy(s.date), s.place,
            s.people.map(id => S.personById[id]?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span>
        </span>
      </button>`).join('')}`).join('');

  host.querySelector('[data-newstory]')?.addEventListener('click', () => openStoryForm());
  host.querySelectorAll('[data-story]').forEach(el => {
    el.onclick = () => openStory(Number(el.dataset.story));
  });
}

export function openStory(id) {
  const s = (S.stories || []).find(x => x.id === id);
  if (!s) return;
  const people = s.people.map(pid => S.personById[pid]).filter(Boolean);
  const body = `
    <div class="muted">${escapeHtml([`${storyKind(s.kind).icon} ${t('sk.' + s.kind)}`, formatFuzzy(s.date), s.place]
      .filter(Boolean).join(' · '))}</div>
    ${s.text ? `<p style="margin-top:12px;white-space:pre-wrap">${escapeHtml(s.text)}</p>` : ''}
    ${people.length ? `<div class="lbl" style="margin-top:16px">${escapeHtml(t('story.who'))}</div>
      ${people.map(p => `<button class="relrow" data-person="${p.id}"><span class="relmain">${avatarHtml(p, 'sm')}
        <span class="nm">${escapeHtml(p.name)}</span></span></button>`).join('')}` : ''}
    ${canEdit() ? `<div class="btnrow" style="margin-top:16px">
      <button class="btn" data-edit>✎ ${escapeHtml(t('ui.edit'))}</button>
      <button class="btn danger" data-delete>${escapeHtml(t('ui.delete'))}</button>
    </div>` : ''}`;

  openSheet(s.title, body, {
    onMount(root) {
      root.querySelectorAll('[data-person]').forEach(btn => {
        btn.onclick = () => openPerson(Number(btn.dataset.person));
      });
      root.querySelector('[data-edit]')?.addEventListener('click', () => openStoryForm(s));
      root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(t('ui.confirm_delete'))) return;
        try {
          await api.del(`/api/stories/${s.id}`);
          await refreshNow();
          closeSheet();
          renderStories();
        } catch (err) { toast(err.message); }
      });
    },
  });
}

export function openStoryForm(s = null, presetPeople = []) {
  const chosen = new Set(s ? s.people : presetPeople);
  const body = `
    <label class="field"><span>${escapeHtml(t('story.title_label'))}</span>
      <input data-f="title" value="${escapeHtml(s?.title || '')}"></label>
    <div class="two">
      <label class="field"><span>${escapeHtml(t('story.kind'))}</span>
        <select data-f="kind">${STORY_KINDS.map(k =>
          `<option value="${k.id}" ${s?.kind === k.id ? 'selected' : ''}>${k.icon} ${escapeHtml(t('sk.' + k.id))}</option>`).join('')}</select></label>
      <label class="field"><span>${escapeHtml(t('story.when'))}</span>
        <input data-f="date" value="${escapeHtml(s?.date ?? todayISO())}" placeholder="${escapeHtml(t('form.fuzzy_ph'))}" autocomplete="off"></label>
    </div>
    <label class="field"><span>${escapeHtml(t('story.where'))}</span>
      <input data-f="place" value="${escapeHtml(s?.place || '')}" autocomplete="off"></label>
    <label class="field"><span>${escapeHtml(t('story.text'))}</span>
      <textarea data-f="text" style="min-height:120px">${escapeHtml(s?.text || '')}</textarea></label>

    <div class="lbl" style="margin-top:16px">${escapeHtml(t('story.who'))}</div>
    <div data-people></div>
    <div class="ppick" data-addperson style="margin-top:8px"></div>

    <button class="btn primary wide" data-save style="margin-top:20px">${escapeHtml(t('ui.save'))}</button>`;

  openSheet(s ? s.title : t('story.new'), body, {
    onMount(root) {
      // Coordinates ride with the place text; a hand edit clears them.
      let coords = { lat: s?.lat ?? null, lon: s?.lon ?? null };
      import('./geo.js').then(geo => geo.attachPlacePicker(root.querySelector('[data-f="place"]'), {
        onPick: hit => { coords = { lat: hit?.lat ?? null, lon: hit?.lon ?? null }; },
      }));

      const drawPeople = () => {
        root.querySelector('[data-people]').innerHTML = [...chosen]
          .map(pid => S.personById[pid]).filter(Boolean)
          .map(p => `<div class="relrow"><span class="relmain">${avatarHtml(p, 'sm')}
            <span class="nm">${escapeHtml(p.name)}</span></span>
            <button class="reledit" data-drop="${p.id}">✕</button></div>`).join('');
        root.querySelectorAll('[data-drop]').forEach(btn => {
          btn.onclick = () => { chosen.delete(Number(btn.dataset.drop)); drawPeople(); };
        });
      };
      drawPeople();
      const picker = personPicker(root.querySelector('[data-addperson]'), {
        onChange: id => {
          if (!id) return;
          chosen.add(id);
          picker.set(null);
          drawPeople();
        },
      });

      root.querySelector('[data-save]').onclick = async () => {
        const g = name => root.querySelector(`[data-f="${name}"]`).value;
        const payload = {
          title: g('title').trim(), kind: g('kind'), date: g('date').trim(),
          place: g('place').trim(), lat: coords.lat, lon: coords.lon,
          text: g('text'), people: [...chosen],
        };
        if (!payload.title) return toast(t('form.name_missing'));
        try {
          if (s) await api.put(`/api/stories/${s.id}`, payload);
          else await api.post('/api/stories', payload);
          await refreshNow();
          closeSheet();
          renderStories();
          toast(t('form.saved'));
        } catch (err) { toast(err.message); }
      };
    },
  });
}

// ------------------------------------------------------------------ places

let placesMap = null;
let yearAll = true;
let yearAt = null;
const YEAR_WINDOW = 10;   // the slider shows ±10 years — a decade in view

/**
 * The Orte tab: every birth, death and story with coordinates on one slippy
 * map, with a year slider to drag through the decades and watch the family
 * move. "Alle Jahre" shows everything at once.
 */
export async function renderPlaces() {
  const host = $('#places-list');
  placesMap?.destroy();
  placesMap = null;

  let data;
  try { data = await api.get('/api/geo/places'); }
  catch (err) { host.innerHTML = `<div class="empty"><span class="big">🗺️</span><div>${escapeHtml(err.message)}</div></div>`; return; }

  const geo = await import('./geo.js');
  const pins = [
    ...data.births.map(geo.birthPin),
    ...data.deaths.map(geo.deathPin),
    ...data.stories.map(geo.storyPin),
  ];

  if (!pins.length) {
    host.innerHTML = `<div class="empty"><span class="big">🗺️</span>
      <div>${escapeHtml(t('places.empty'))}</div>
      <div class="muted">${escapeHtml(t('places.how'))}</div></div>`;
    return;
  }

  const years = pins.map(p => p.year).filter(y => y != null);
  const minYear = years.length ? Math.min(...years) : 1900;
  const maxYear = years.length ? Math.max(...years) : 2000;
  if (yearAt == null) yearAt = maxYear;

  host.innerHTML = `
    <div class="yearctl">
      <button class="chip sm ${yearAll ? 'on' : ''}" data-all>${escapeHtml(t('places.all_years'))}</button>
      <input type="range" min="${minYear}" max="${maxYear}" value="${yearAt}" data-year ${yearAll ? 'disabled' : ''}>
      <b data-yearlabel>${yearAll ? '' : yearAt}</b>
    </div>
    <div class="gm-host" data-map></div>`;

  const visible = () => (yearAll
    ? pins
    : pins.filter(p => p.year != null && Math.abs(p.year - yearAt) <= YEAR_WINDOW));

  placesMap = geo.createMap(host.querySelector('[data-map]'), {
    pins: visible(),
    onPin: pin => {
      if (pin.kind === 'person') openPerson(pin.id);
      else openStory(pin.id);
    },
  });

  const slider = host.querySelector('[data-year]');
  const label = host.querySelector('[data-yearlabel]');
  slider.oninput = () => {
    yearAt = Number(slider.value);
    label.textContent = yearAt;
    placesMap.setPins(visible());
  };
  host.querySelector('[data-all]').onclick = e => {
    yearAll = !yearAll;
    e.currentTarget.classList.toggle('on', yearAll);
    slider.disabled = yearAll;
    label.textContent = yearAll ? '' : yearAt;
    placesMap.setPins(visible());
  };
}
