// Everything geographic in the browser: a small slippy map drawn from
// OpenStreetMap tiles, and the place picker that hangs off a text field.
// Ported from Friend-Map — no map library on purpose, for the same reason
// there is no framework: a raster map is a grid of 256px images placed by
// Web Mercator arithmetic, and that arithmetic is the twenty lines below.
// Pins are real buttons, so they can be tapped, labelled and read out by a
// screen reader for free.
import { api } from './api.js';
import { S, mapCfg, escapeHtml, branchesWithParents } from './store.js';
import { formatFuzzy } from './fuzzydate.js';
import { t } from './i18n.js';

const TILE = 256;
const MIN_Z = 2;
const MAX_Z = 19;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const tileTemplate = () => mapCfg.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Tiles normally come straight from OpenStreetMap — light, direct use is what
// their policy is written for. But their servers require a Referer, and some
// browsers strip that from cross-origin requests whatever the page asks for.
// Once we have seen that happen, every map in this session routes through our
// own server instead. Not sticky beyond the session.
let viaServer = false;
const tileSrc = (z, x, y) => (viaServer
  ? `/api/geo/tile/${z}/${x}/${y}`
  : tileTemplate().replace('{z}', z).replace('{x}', x).replace('{y}', y));

// ------------------------------------------------------------------ mercator

const worldSize = z => TILE * 2 ** z;

export function project(lat, lon, z) {
  const size = worldSize(z);
  const rad = clamp(lat, -85.05, 85.05) * Math.PI / 180;
  return {
    x: (lon + 180) / 360 * size,
    y: (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * size,
  };
}

export function unproject(x, y, z) {
  const size = worldSize(z);
  const n = Math.PI - 2 * Math.PI * y / size;
  return {
    lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lon: x / size * 360 - 180,
  };
}

// ------------------------------------------------------------------ the map

/**
 * Puts a map inside `host`, which must have a size of its own from CSS.
 * Returns a handle: `setPins`, `flyTo`, `fit`, `destroy`.
 */
export function createMap(host, { pins = [], center = null, zoom = 13, onPin = null } = {}) {
  host.classList.add('gm');
  host.innerHTML = `
    <div class="gm-tiles"></div>
    <div class="gm-pins"></div>
    <div class="gm-ctl">
      <button type="button" data-in aria-label="+">+</button>
      <button type="button" data-out aria-label="−">−</button>
    </div>
    <a class="gm-attr" href="https://www.openstreetmap.org/copyright"
       target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>`;

  const tilesEl = host.querySelector('.gm-tiles');
  const pinsEl = host.querySelector('.gm-pins');
  const tiles = new Map();          // key → <img>
  let view = { ...(center || { lat: 51.1, lon: 10.4 }), zoom };
  let list = pins;

  const size = () => ({ w: host.clientWidth || 320, h: host.clientHeight || 220 });

  // Nothing arriving means one of two things, and they need different
  // answers: a browser that will not identify us (retry through our server),
  // or a tile server that is genuinely down (say so).
  let served = 0;
  let refused = 0;
  let attempt = 0;   // bumped when the source changes, so in-flight failures don't blame the new one

  function tileFailed(from) {
    if (from !== attempt) return;
    refused++;
    if (served || refused < 3) return;
    if (!viaServer) {
      viaServer = true;                 // for this map and every later one
      attempt++;
      refused = 0;
      tiles.forEach(img => img.remove());
      tiles.clear();
      render();
      return;
    }
    if (!host.querySelector('.gm-note')) {
      const el = document.createElement('div');
      el.className = 'gm-note';
      el.textContent = t('places.tiles_down');
      host.appendChild(el);
    }
  }

  /** Top-left corner of the viewport, in world pixels. */
  function origin() {
    const { w, h } = size();
    const c = project(view.lat, view.lon, view.zoom);
    return { x: c.x - w / 2, y: c.y - h / 2 };
  }

  function render() {
    const { w, h } = size();
    const o = origin();
    const span = 2 ** view.zoom;
    const wanted = new Set();

    for (let ty = Math.floor(o.y / TILE); ty <= Math.floor((o.y + h) / TILE); ty++) {
      if (ty < 0 || ty >= span) continue;                       // no tiles past the poles
      for (let tx = Math.floor(o.x / TILE); tx <= Math.floor((o.x + w) / TILE); tx++) {
        const wrapped = ((tx % span) + span) % span;            // the world repeats sideways
        const key = `${view.zoom}/${wrapped}/${ty}/${tx}`;
        wanted.add(key);
        let img = tiles.get(key);
        if (!img) {
          img = new Image();
          img.alt = '';
          img.loading = 'eager';
          // OSM's tile policy requires a Referer, and our own
          // `Referrer-Policy: same-origin` strips it from cross-origin
          // requests — only the tiles opt out, and only to the bare origin.
          img.referrerPolicy = 'origin';
          const from = attempt;
          img.src = tileSrc(view.zoom, wrapped, ty);
          img.onload = () => { if (from === attempt) served++; };
          img.onerror = () => { img.classList.add('miss'); tileFailed(from); };
          tilesEl.appendChild(img);
          tiles.set(key, img);
        }
        img.style.transform = `translate3d(${tx * TILE - o.x}px, ${ty * TILE - o.y}px, 0)`;
      }
    }
    for (const [key, img] of tiles) {
      if (!wanted.has(key)) { img.remove(); tiles.delete(key); }
    }
    renderPins(o);
  }

  function renderPins(o = origin()) {
    const span = worldSize(view.zoom);
    const taken = new Map();
    pinsEl.innerHTML = list.map((pin, i) => {
      const p = project(pin.lat, pin.lon, view.zoom);
      // Draw the copy of the world nearest to what is on screen.
      let x = p.x - o.x;
      while (x < -span / 2) x += span;
      while (x > span / 2) x -= span;
      let y = p.y - o.y;
      // Half a village is born in the same church. Stacked pins are one pin
      // as far as a thumb is concerned, so fan the repeats out.
      const cell = `${Math.round(x / 8)}:${Math.round(y / 8)}`;
      const over = taken.get(cell) || 0;
      taken.set(cell, over + 1);
      x += over * 15;
      y -= over * 7;
      return `<button type="button" class="gm-pin" data-pin="${i}"
        style="transform:translate3d(${x}px, ${y}px, 0)">
        <span class="gm-dot" style="background:${escapeHtml(pin.color || 'var(--accent)')}">${escapeHtml(pin.icon || '')}</span>
        <span class="gm-label">${escapeHtml(pin.label || '')}${
          pin.sub ? `<span class="sub">${escapeHtml(pin.sub)}</span>` : ''}</span>
      </button>`;
    }).join('');
    pinsEl.querySelectorAll('[data-pin]').forEach(el => {
      el.onclick = event => {
        event.stopPropagation();
        const pin = list[Number(el.dataset.pin)];
        pinsEl.querySelectorAll('.gm-pin').forEach(x => x.classList.remove('on'));
        el.classList.add('on');
        onPin?.(pin, el);
      };
    });
  }

  /** Keep the point under (px, py) fixed while the zoom changes around it. */
  function zoomAround(next, px, py) {
    const z = clamp(Math.round(next), MIN_Z, MAX_Z);
    if (z === view.zoom) return;
    const { w, h } = size();
    const o = origin();
    const under = unproject(o.x + px, o.y + py, view.zoom);
    view.zoom = z;
    const p = project(under.lat, under.lon, z);
    view = { ...unproject(p.x - px + w / 2, p.y - py + h / 2, z), zoom: z };
    render();
  }

  /** The smallest view that holds every pin, or a close-up for a single one. */
  function fit(items = list, pad = 44) {
    if (!items.length) return;
    if (items.length === 1) {
      view = { lat: items[0].lat, lon: items[0].lon, zoom: 12 };
      return;
    }
    const { w, h } = size();
    for (let z = MAX_Z; z >= MIN_Z; z--) {
      const xs = items.map(i => project(i.lat, i.lon, z).x);
      const ys = items.map(i => project(i.lat, i.lon, z).y);
      const dx = Math.max(...xs) - Math.min(...xs);
      const dy = Math.max(...ys) - Math.min(...ys);
      if (dx <= Math.max(1, w - pad * 2) && dy <= Math.max(1, h - pad * 2)) {
        const mid = unproject((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, z);
        view = { ...mid, zoom: z };
        return;
      }
    }
    view = { lat: items[0].lat, lon: items[0].lon, zoom: MIN_Z };
  }

  // ---- gestures. Pointer events, so a mouse and a thumb take the same path.
  const down = new Map();
  let pinchFrom = 0;

  host.addEventListener('pointerdown', event => {
    if (event.target.closest('.gm-ctl, .gm-attr, .gm-pin')) return;
    host.setPointerCapture(event.pointerId);
    down.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (down.size === 2) pinchFrom = spread();
  });

  function spread() {
    const [a, b] = [...down.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  host.addEventListener('pointermove', event => {
    const prev = down.get(event.pointerId);
    if (!prev) return;
    const dx = event.clientX - prev.x;
    const dy = event.clientY - prev.y;
    down.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (down.size === 2) {
      const now = spread();
      if (pinchFrom && Math.abs(now - pinchFrom) > 60) {
        const box = host.getBoundingClientRect();
        const [a, b] = [...down.values()];
        zoomAround(view.zoom + (now > pinchFrom ? 1 : -1),
          (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top);
        pinchFrom = now;
      }
      return;
    }
    const o = origin();
    const { w, h } = size();
    view = { ...unproject(o.x - dx + w / 2, o.y - dy + h / 2, view.zoom), zoom: view.zoom };
    render();
  });

  const release = event => {
    down.delete(event.pointerId);
    if (down.size < 2) pinchFrom = 0;
  };
  host.addEventListener('pointerup', release);
  host.addEventListener('pointercancel', release);

  host.addEventListener('wheel', event => {
    event.preventDefault();
    const box = host.getBoundingClientRect();
    zoomAround(view.zoom + (event.deltaY < 0 ? 1 : -1), event.clientX - box.left, event.clientY - box.top);
  }, { passive: false });

  host.querySelector('[data-in]').onclick = () => {
    const { w, h } = size();
    zoomAround(view.zoom + 1, w / 2, h / 2);
  };
  host.querySelector('[data-out]').onclick = () => {
    const { w, h } = size();
    zoomAround(view.zoom - 1, w / 2, h / 2);
  };

  // The host is usually revealed after being display:none, when it still had
  // no size to lay tiles out against.
  const resize = new ResizeObserver(() => render());
  resize.observe(host);

  if (!center) fit();
  render();

  return {
    get view() { return { ...view }; },
    setPins(next) { list = next; renderPins(); },
    flyTo(lat, lon, z = 12) { view = { lat, lon, zoom: clamp(z, MIN_Z, MAX_Z) }; render(); },
    fit(items) { fit(items); render(); },
    destroy() { resize.disconnect(); host.innerHTML = ''; host.classList.remove('gm'); },
  };
}

// ------------------------------------------------------------------ pins

/** A birth as a pin, in the person's branch colour. */
export function birthPin(row) {
  const p = S.personById[row.id];
  const branch = p ? S.branchById[branchesWithParents(p)[0]] : null;
  return {
    lat: row.lat, lon: row.lon, kind: 'person', id: row.id, year: row.year,
    label: row.name, icon: '',
    sub: [`* ${row.year ?? ''}`.trim(), row.place].filter(Boolean).join(' · '),
    color: branch?.color || 'var(--accent)',
  };
}

export const deathPin = row => ({
  lat: row.lat, lon: row.lon, kind: 'person', id: row.id, year: row.year,
  label: row.name, icon: '',
  sub: [`† ${row.year ?? ''}`.trim(), row.place].filter(Boolean).join(' · '),
  color: 'var(--ink-3)',
});

export const storyPin = s => ({
  lat: s.lat, lon: s.lon, kind: 'story', id: s.id, year: s.year,
  label: s.title, icon: '',
  sub: [formatFuzzy(s.date), s.place].filter(Boolean).join(' · '),
  color: 'var(--love)',
});

// ------------------------------------------------------------------ picker

/**
 * Place suggestions under a text field. Nominatim asks not to be queried per
 * keystroke, so this waits for a pause and a query worth sending — and the
 * server caches on top of that. Places the family already knows come first
 * and cost no network at all: half a family tree is born in three towns.
 *
 * `onPick` gets `{ label, lat, lon }`, or `null` when the field is edited by
 * hand and the coordinates no longer describe what it says.
 */
export function attachPlacePicker(input, { onPick } = {}) {
  const box = document.createElement('div');
  box.className = 'gm-suggest';
  box.hidden = true;
  input.insertAdjacentElement('afterend', box);

  let timer = null;
  let lastSent = '';

  const hide = () => { box.hidden = true; box.innerHTML = ''; };

  /** Every place with coordinates the tree already holds, deduped. */
  function knownPlaceHits(q) {
    const needle = q.toLowerCase();
    const seen = new Map();
    const offer = (place, lat, lon) => {
      const key = String(place || '').trim().toLowerCase();
      if (!key || lat == null || lon == null || seen.has(key)) return;
      if (needle && !key.includes(needle)) return;
      seen.set(key, { label: place, sub: t('places.known'), lat, lon, known: true });
    };
    for (const p of S.persons) {
      offer(p.birth_place, p.birth_lat, p.birth_lon);
      offer(p.death_place, p.death_lat, p.death_lon);
    }
    for (const s of S.stories || []) offer(s.place, s.lat, s.lon);
    return [...seen.values()].slice(0, 4);
  }

  function show(hits) {
    if (!hits.length) return hide();
    box.hidden = false;
    box.innerHTML = hits.map((h, i) => `<button type="button" class="gm-hit" data-hit="${i}">
      <span class="ic">${h.known ? '🏠' : '📍'}</span>
      <span><b>${escapeHtml(h.label)}</b>${h.sub ? `<span class="sub">${escapeHtml(h.sub)}</span>` : ''}</span>
    </button>`).join('');
    box.querySelectorAll('[data-hit]').forEach(el => {
      // pointerdown, not click: a tap first blurs the input, the blur hides
      // this list, and the click then lands on whatever moved underneath —
      // which read as "the suggestions cannot be selected". pointerdown
      // fires before the blur, and preventDefault keeps the focus where it
      // is so the keyboard does not flicker shut on a phone.
      el.onpointerdown = e => {
        e.preventDefault();
        const hit = hits[Number(el.dataset.hit)];
        input.value = hit.label;
        lastSent = hit.label.trim().toLowerCase();
        hide();
        onPick?.({ label: hit.label, lat: hit.lat, lon: hit.lon });
      };
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    // Whatever coordinates were picked no longer describe what the field says.
    onPick?.(null);
    const q = input.value.trim();
    if (q.length < 3) return show(knownPlaceHits(q));

    show(knownPlaceHits(q));                            // instant, no network
    timer = setTimeout(async () => {
      if (q.toLowerCase() === lastSent) return;
      lastSent = q.toLowerCase();
      try {
        const { hits } = await api.get(`/api/geo/search?q=${encodeURIComponent(q)}`);
        if (input.value.trim() !== q) return;   // they kept typing
        show([...knownPlaceHits(q),
          ...hits.map(h => ({ label: h.short, sub: h.label, lat: h.lat, lon: h.lon }))]);
      } catch { /* a failed lookup is not worth a toast while typing */ }
    }, 700);
  });

  // The family's places stand before a single letter is typed.
  input.addEventListener('focus', () => { if (box.hidden) show(knownPlaceHits(input.value.trim())); });

  // Selection happens on pointerdown (above), so the blur only has to wait
  // out its own event turn — but a generous delay costs nothing and covers
  // assistive tech that clicks without a pointer.
  input.addEventListener('blur', () => setTimeout(hide, 250));
  return { hide };
}
