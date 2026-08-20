// The tree canvas: a tidy genealogy chart with the gestures of a map.
//
// Where everyone stands is decided in layout.js and only drawn here. This
// file owns the camera, the gestures, the collision field that keeps text
// readable, the branch blobs — and the line language:
//
//   partners   a short horizontal bar between two adjacent dots
//   descent    an orthogonal drop from the union, a sibling bar across the
//              children, a short drop to each of them
//   others     described relationships, drawn only when you ask for them,
//              because as permanent diagonals they crossed everything
//
// Nothing runs at import time — tests/layout.test.js imports this under
// plain node to check the rules without a canvas.
import { api } from './api.js';
import {
  S, colorOf, passesFilters, matchesSearch, inSpotlight, relsOf, otherEnd,
  branchesWithParents, parentsOfP, childrenOfP, spousesOfP,
  unionPartners, unionChildren,
} from './store.js';
import { computeLayout, reorderRow, ROW } from './layout.js';
import { t } from './i18n.js';

export { ROW };
export const YEAR_PX = 3.4;        // world units per year in Zeit mode
const EASE = 0.18;                 // how fast people slide to where they belong
const FONT_BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_DISPLAY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

let cv, ctx, dpr = 1;
let cam = { x: 0, y: 0, scale: 0.9 };
let looping = false;
let drag = null, dragMoved = false, tapCandidate = null, pointerStart = null, pinch = null;
let pressTimer = null, pressFired = false;   // a long press spotlights, it never opens the card
let lastPinchAt = 0;                          // lifting two fingers fires the same pointerup a tap does
let onSelect = () => {};
let highlight = null;                         // { people:Set, rels:Set }
let camFollows = true;
let mode = 'gen';                             // 'gen' | 'zeit'
let showAllEdges = false;
let layout = null, layoutDirty = true;

export const allEdgesShown = () => showAllEdges;
export function setAllEdges(on) { showAllEdges = Boolean(on); draw(); }
export const layoutMode = () => mode;
export function setLayoutMode(m) {
  mode = m === 'zeit' ? 'zeit' : 'gen';
  relayout();
}

/** The arrangement is stale — recompute it and slide everyone into place. */
export function relayout() {
  layoutDirty = true;
  if (!looping && cv) { looping = true; requestAnimationFrame(tick); }
}

export function initMap(canvas, opts = {}) {
  cv = canvas;
  ctx = cv.getContext('2d');
  onSelect = opts.onSelect || onSelect;

  const ro = new ResizeObserver(resize);
  ro.observe(cv);
  resize();

  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  // A cancelled pointer (incoming call, palm rejection, OS gesture) is not a
  // tap — routing it through onUp opened cards nobody asked for.
  cv.addEventListener('pointercancel', onCancel);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('touchstart', onTouchStart, { passive: false });
  cv.addEventListener('touchmove', onTouchMove, { passive: false });
  cv.addEventListener('touchend', onTouchEnd);
  // A held finger is our gesture (the spotlight), not the browser's.
  cv.addEventListener('contextmenu', e => e.preventDefault());
}

function resize() {
  if (!cv) return;
  dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  cv.width = Math.max(1, cv.clientWidth * dpr);
  cv.height = Math.max(1, cv.clientHeight * dpr);
  draw();
}

// ------------------------------------------------------------------ geometry

const w2s = (x, y) => [(x - cam.x) * cam.scale + cv.clientWidth / 2, (y - cam.y) * cam.scale + cv.clientHeight / 2];
const s2w = (sx, sy) => [(sx - cv.clientWidth / 2) / cam.scale + cam.x, (sy - cv.clientHeight / 2) / cam.scale + cam.y];

function radiusOf(p) {
  if (p.id === S.probandId) return 20;
  return Math.abs(p._gen ?? 0) >= 3 ? 12 : 14;
}

// ------------------------------------------------------------------ layout rules
//
// Pure functions of the graph — no canvas, no camera — which is what
// tests/layout.test.js checks.

/**
 * Signed generations, walked out from the proband: a parent is +1, a child
 * −1, a partner ±0. First visit wins — a marriage across generations keeps
 * the reading closest to the proband, which is the honest choice when the
 * graph genuinely disagrees with itself.
 */
export function indexGenerations(people) {
  const shown = new Set(people.map(p => p.id));
  for (const p of people) p._gen = null;
  const start = S.personById[S.probandId];
  if (!start) { for (const p of people) p._gen = 0; return; }
  start._gen = 0;
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const steps = [
      ...parentsOfP(cur.id).map(id => [id, cur._gen + 1]),
      ...childrenOfP(cur.id).map(id => [id, cur._gen - 1]),
      ...spousesOfP(cur.id).map(id => [id, cur._gen]),
    ];
    for (const [id, gen] of steps) {
      if (!shown.has(id)) continue;
      const next = S.personById[id];
      if (!next || next._gen !== null) continue;
      next._gen = gen;
      queue.push(next);
    }
  }
  for (const p of people) if (p._gen === null) p._gen = 0;
}

/** The generation row's Y. Ancestors up (negative y), descendants down. */
export const genY = gen => (gen ? -gen * ROW : 0);

/**
 * A year for everyone the Zeit axis can seat. Missing birth years are
 * estimated from the family around them — parents put a child ~28 years
 * later, children put a parent ~28 earlier, partners sit level — over a few
 * passes, so a chain of undated people still finds its place.
 */
export function indexYears(people) {
  for (const p of people) p._year = p.birth_year ?? null;
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const p of people) {
      if (p._year !== null) continue;
      const guesses = [
        ...parentsOfP(p.id).map(id => S.personById[id]?._year).filter(y => y != null).map(y => y + 28),
        ...childrenOfP(p.id).map(id => S.personById[id]?._year).filter(y => y != null).map(y => y - 28),
        ...spousesOfP(p.id).map(id => S.personById[id]?._year).filter(y => y != null),
      ];
      if (guesses.length) {
        p._year = Math.round(guesses.reduce((s, y) => s + y, 0) / guesses.length);
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (const p of people) {
    if (p._year === null && p.death_year != null) p._year = p.death_year - 40;
  }
}

/** The Zeit baseline: the proband's year anchors 0, so the view starts home. */
export function zeitBase(people) {
  const me = S.personById[S.probandId];
  if (me && me._year != null) return me._year;
  const years = people.map(p => p._year).filter(y => y != null).sort((a, b) => a - b);
  return years.length ? years[Math.floor(years.length / 2)] : 1950;
}

export const zeitY = (year, base) => (year - base) * YEAR_PX;

/**
 * How much of a described-relationship thread to draw, 0..1 — a score
 * against a threshold that falls as you zoom in. The tree structure is
 * never thinned; only these earn their place. Handed the zoom rather than
 * reading the camera, so the rule tests without a canvas.
 */
export function edgeRoom(r, a, b, scale, all = false) {
  if (all) return 1;
  let score = 2;
  if (r.label) score += 0.8;                        // a described link has something to say
  if (a.id === S.probandId || b.id === S.probandId) score += 1.2;
  if (a._huddles && b._huddles && a._huddles.some(h => b._huddles.includes(h))) score -= 2.5;
  const floor = 5.5 - Math.min(1.6, scale) * 4.2;
  return Math.max(0, Math.min(1, (score - floor + 0.8) / 1.2));
}

/** A thread's words cost more than its line — they come once it is nearly full. */
export const labelEarned = (r, a, b, scale, all = false) =>
  scale > 0.9 && edgeRoom(r, a, b, scale, all) >= 0.85;

// ------------------------------------------------------------------ people

function visiblePeople() {
  const list = S.persons.filter(p => passesFilters(p));
  indexGenerations(list);
  if (mode === 'zeit') indexYears(list);
  return list;
}

/** Recompute where everyone belongs, and give them somewhere to slide from. */
function rebuild(people) {
  const base = mode === 'zeit' ? zeitBase(people) : 0;
  layout = computeLayout(people, {
    unions: S.unions,
    partnersOf: uid => unionPartners(uid),
    childrenOf: uid => unionChildren(uid),
    unionsOf: id => (S.unionsOfPerson[id] || []),
    parentUnionsOf: id => (S.parentUnionsOf[id] || []),
    yOf: p => (mode === 'zeit' && p._year != null ? zeitY(p._year, base) : genY(p._gen)),
  });
  for (const p of people) {
    const seat = layout.people.get(p.id);
    if (!seat) continue;
    p.tx = seat.x; p.ty = seat.y;
    // Somebody arriving for the first time starts where they belong rather
    // than sliding in from a corner of the world.
    if (p.x == null || Number.isNaN(p.x)) { p.x = seat.x; p.y = seat.y; }
  }
  layoutDirty = false;
}

/** Slide everyone toward their seat; true while anyone is still moving. */
function settle(people) {
  let moving = false;
  for (const p of people) {
    if (drag?.person === p) continue;
    if (p.tx == null) continue;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { p.x = p.tx; p.y = p.ty; continue; }
    p.x += dx * EASE;
    p.y += dy * EASE;
    moving = true;
  }
  return moving;
}

function tick() {
  const people = visiblePeople();
  if (layoutDirty) rebuild(people);
  const moving = settle(people);
  if (camFollows) followCluster(people);
  drawScene(people);
  if (moving || drag) requestAnimationFrame(tick);
  else looping = false;
}

function followCluster(people) {
  if (!people.length) return;
  let cx = 0, cy = 0;
  for (const p of people) { cx += p.x; cy += p.y; }
  cx /= people.length; cy /= people.length;
  cam.x += (cx - cam.x) * 0.08;
  cam.y += (cy - cam.y) * 0.08;
}

/** Throw away every hand-made arrangement and let the layout decide again. */
export async function resetArrangement() {
  try { await api.del('/api/layout-order'); } catch { /* reported by the caller */ }
  for (const p of S.persons) p.order_key = null;
  relayout();
}

// ------------------------------------------------------------------ drawing

export function draw() {
  if (!ctx) return;
  const people = visiblePeople();
  if (layoutDirty) rebuild(people);
  drawScene(people);
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Rectangles already spoken for this frame — dots first, then names, so a
// name is never drawn on top of something you were meant to read.
let taken = [];
const claim = (x, y, w, h) => taken.push([x, y, x + w, y + h]);
function free(x, y, w, h) {
  for (const [x1, y1, x2, y2] of taken) {
    if (x < x2 && x + w > x1 && y < y2 && y + h > y1) return false;
  }
  return true;
}

const alwaysNamed = (p, searching) =>
  p.id === S.probandId || Boolean(highlight?.people.has(p.id)) || (searching && matchesSearch(p));

function drawScene(people) {
  const W = cv.clientWidth, H = cv.clientHeight;
  taken = [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const ink = css('--ink') || '#232320';
  const ink2 = css('--ink-2') || '#5E5B52';
  const ink3 = css('--ink-3') || '#8B8779';
  const line = css('--line-2') || '#C7C2B3';
  const paper = css('--card') || '#fff';
  const family = css('--family') || '#A6743C';
  const love = css('--love') || '#C13D51';
  const zoom = Math.min(1.6, Math.max(0.55, cam.scale));
  const searching = S.search.trim().length > 0;
  const base = mode === 'zeit' ? zeitBase(people) : 0;

  if (mode === 'zeit') drawYearRuler(H, W, base, ink3, line);

  // Every dot books its space first; the always-named book their names too.
  for (const p of people) {
    const [x, y] = w2s(p.x, p.y);
    const r = radiusOf(p) * zoom;
    claim(x - r, y - r, r * 2, r * 2);
    if (!alwaysNamed(p, searching)) continue;
    const size = Math.round((p.id === S.probandId ? 13 : 11.5) * zoom);
    ctx.font = `${p.id === S.probandId ? 600 : 400} ${size}px ${FONT_BODY}`;
    const w = ctx.measureText(p.name).width;
    claim(x - w / 2, y + r + 4, w, size + 3);
  }

  drawHulls(people, zoom);

  const shown = new Set(people.map(p => p.id));

  // ---- the tree itself. Never thinned: the structure is the map.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const u of layout?.unions || []) {
    const seats = u.partners.filter(id => shown.has(id)).map(id => S.personById[id]).filter(Boolean);
    const kids = u.kids.filter(id => shown.has(id)).map(id => S.personById[id]).filter(Boolean);
    if (!seats.length) continue;
    const litUnion = highlight && seats.every(p => highlight.people.has(p.id));
    const dimUnion = (highlight && !litUnion) || seats.some(p => !inSpotlight(p));

    // The partner bar — short and horizontal, because the two of them are
    // neighbours in their row by construction.
    if (seats.length === 2) {
      const [a, b] = seats.map(p => w2s(p.x, p.y));
      ctx.save();
      ctx.globalAlpha = dimUnion ? 0.12 : 0.9;
      ctx.strokeStyle = litUnion ? css('--accent') : love;
      ctx.lineWidth = Math.max(1.6, 3 * Math.min(1.4, cam.scale));
      if (u.kind === 'partnerschaft') ctx.setLineDash([7, 5]);
      else if (u.kind !== 'ehe') ctx.setLineDash([2, 5]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.restore();
    }

    if (!kids.length) continue;

    // The descent: down from between the parents, a sibling bar across all
    // the children, then a short drop onto each of them. This is the shape
    // every family chart uses, and it is why siblings read as siblings.
    const anchor = w2s(seats.reduce((s, p) => s + p.x, 0) / seats.length,
      seats.reduce((s, p) => s + p.y, 0) / seats.length);
    const kidPts = kids.map(k => ({ k, pt: w2s(k.x, k.y) }));
    const topKid = Math.min(...kidPts.map(({ pt }) => pt[1]));
    // The lane the layout gave this family keeps its sibling bar off the one
    // beside it — see laneShelves() for why that is not cosmetic.
    const lane = (u.lane + 0.5) / (u.lanes || 1);
    const shelf = anchor[1] + (topKid - anchor[1]) * (0.34 + 0.46 * lane);
    const dim = dimUnion;

    ctx.save();
    ctx.globalAlpha = dim ? 0.12 : 0.75;
    ctx.strokeStyle = litUnion ? css('--accent') : family;
    ctx.lineWidth = Math.max(1.1, 1.9 * Math.min(1.4, cam.scale));
    ctx.beginPath();
    ctx.moveTo(anchor[0], anchor[1]);
    ctx.lineTo(anchor[0], shelf);
    if (kidPts.length > 1) {
      ctx.moveTo(Math.min(...kidPts.map(({ pt }) => pt[0])), shelf);
      ctx.lineTo(Math.max(...kidPts.map(({ pt }) => pt[0])), shelf);
    }
    ctx.stroke();
    ctx.restore();

    for (const { k, pt } of kidPts) {
      const role = S.children.find(c => c.union_id === u.id && c.child_id === k.id)?.role;
      ctx.save();
      ctx.globalAlpha = dim || !inSpotlight(k) ? 0.12 : 0.75;
      ctx.strokeStyle = litUnion && highlight?.people.has(k.id) ? css('--accent') : family;
      ctx.lineWidth = Math.max(1.1, 1.9 * Math.min(1.4, cam.scale));
      // Only the child's own drop is dashed: the family they were taken
      // into is no less theirs, but how they arrived is worth saying.
      if (role && role !== 'leiblich') ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pt[0], shelf);
      ctx.lineTo(pt[0], pt[1]);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- described relationships. Off unless you ask: as permanent
  // diagonals across the whole chart they buried everything else.
  const edgeLabels = [];
  if (highlight || showAllEdges) {
    for (const r of S.relationships) {
      if (!shown.has(r.a_id) || !shown.has(r.b_id)) continue;
      const a = S.personById[r.a_id], b = S.personById[r.b_id];
      if (!a || !b) continue;
      const lit = highlight?.rels.has(r.id);
      if (highlight && !lit && !showAllEdges) continue;
      const room = lit ? 1 : edgeRoom(r, a, b, cam.scale, showAllEdges);
      if (room <= 0.01) continue;

      const [x1, y1] = w2s(a.x, a.y), [x2, y2] = w2s(b.x, b.y);
      ctx.save();
      ctx.globalAlpha = (lit ? 0.95 : 0.4) * room;
      ctx.lineWidth = lit ? 3 : Math.max(0.8, 1.1 * Math.min(1.4, cam.scale));
      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = lit ? css('--accent') : line;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();

      const reason = r.label || t('rel.' + r.kind);
      if (reason && (lit || labelEarned(r, a, b, cam.scale, showAllEdges))) {
        edgeLabels.push({ reason, x1, y1, x2, y2, lit, room });
      }
    }
  }

  // ---- nodes
  for (const p of people) {
    const [x, y] = w2s(p.x, p.y);
    const r = radiusOf(p) * zoom;
    const lit = highlight?.people.has(p.id);
    const hit = searching && matchesSearch(p);
    const dimmed = (highlight && !lit) || (searching && !hit) || !inSpotlight(p);
    const dead = Boolean(p.death) || (p.death_year != null);

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.16 : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.id === S.probandId ? ink : (colorOf(p) || css('--ungrouped') || '#9A968C');
    ctx.fill();
    // Someone who has died wears a ring rather than a solid edge — the one
    // fact a chart of a family should be able to show without a word.
    ctx.lineWidth = dead ? 2.5 : 2;
    ctx.strokeStyle = dead ? ink3 : paper;
    ctx.stroke();
    if (lit || hit) {
      ctx.beginPath();
      ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = css('--accent');
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- names, earned: scored against a threshold that falls as you zoom
  // in, and never drawn over something already there.
  const room = 7.4 - Math.min(1.9, cam.scale) * 5.2;
  const spotlight = S.litBranches.size > 0;
  const ranked = people
    .map(p => ({
      p,
      lit: highlight?.people.has(p.id),
      hit: searching && matchesSearch(p),
      score: p.id === S.probandId ? 99
        : 3 + (Math.abs(p._gen ?? 0) <= 1 ? 2 : 0)
          + Math.min(2, (spousesOfP(p.id).length + childrenOfP(p.id).length) * 0.5)
          + (spotlight && inSpotlight(p) ? 3 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  for (const { p, lit, hit, score } of ranked) {
    const dimmed = (highlight && !lit) || (searching && !hit) || !inSpotlight(p);
    if (dimmed && !hit) continue;
    const must = alwaysNamed(p, searching);
    if (!must && score < room) continue;

    const [x, y] = w2s(p.x, p.y);
    const r = radiusOf(p) * zoom;
    const isCentre = p.id === S.probandId;
    const size = Math.round((isCentre ? 13 : 11.5) * zoom);
    ctx.font = `${isCentre ? 600 : 400} ${size}px ${FONT_BODY}`;
    const w = ctx.measureText(p.name).width;
    const top = y + r + 4;
    if (!must && !free(x - w / 2, top, w, size + 3)) continue;
    claim(x - w / 2, top, w, size + 3);

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.3 : 0.92;
    ctx.fillStyle = isCentre ? ink : ink2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(p.name, x, top);
    // Zoomed right in, the years join the name — the tree becomes a record.
    if (cam.scale > 1.15 && (p.birth_year || p.death_year)) {
      const years = `${p.birth_year ?? '·'}–${p.death_year ?? ''}`;
      const ysize = Math.round(9 * zoom);
      ctx.font = `${ysize}px ${FONT_BODY}`;
      const yw = ctx.measureText(years).width;
      if (free(x - yw / 2, top + size + 2, yw, ysize + 2)) {
        claim(x - yw / 2, top + size + 2, yw, ysize + 2);
        ctx.fillStyle = ink3;
        ctx.fillText(years, x, top + size + 2);
      }
    }
    ctx.restore();
  }

  // ---- thread labels, last of all, in the same collision field.
  edgeLabels.sort((a, b) => (b.lit === a.lit ? b.room - a.room : b.lit ? 1 : -1));
  ctx.font = `${Math.round(9.5 * zoom)}px ${FONT_BODY}`;
  for (const L of edgeLabels) {
    const w = ctx.measureText(L.reason).width;
    if (w + 62 * zoom > Math.hypot(L.x2 - L.x1, L.y2 - L.y1)) continue;
    const mx = (L.x1 + L.x2) / 2, my = (L.y1 + L.y2) / 2;
    let ang = Math.atan2(L.y2 - L.y1, L.x2 - L.x1);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    const h = 13 * zoom;
    const bw = Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang));
    const bh = Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang));
    if (!free(mx - bw / 2, my - bh / 2, bw, bh)) continue;
    claim(mx - bw / 2, my - bh / 2, bw, bh);

    ctx.save();
    ctx.translate(mx, my); ctx.rotate(ang);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = paper;
    ctx.fillRect(-w / 2 - 3, -h / 2, w + 6, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = L.lit ? css('--accent') : ink3;
    ctx.fillText(L.reason, 0, 0);
    ctx.restore();
  }
}

/** The Zeit mode's backdrop: a faint decade ruler behind the whole tree. */
function drawYearRuler(H, W, base, ink3, line) {
  const topYear = base + s2w(0, 0)[1] / YEAR_PX;
  const botYear = base + s2w(0, H)[1] / YEAR_PX;
  const span = Math.abs(botYear - topYear);
  const stepYears = span > 260 ? 50 : span > 110 ? 25 : 10;
  const first = Math.ceil(Math.min(topYear, botYear) / stepYears) * stepYears;
  ctx.save();
  ctx.font = `10px ${FONT_BODY}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let year = first; year <= Math.max(topYear, botYear); year += stepYears) {
    const [, sy] = w2s(0, zeitY(year, base));
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = ink3;
    ctx.fillText(String(year), 8, sy - 7);
  }
  ctx.restore();
}

/**
 * Members of one branch actually sitting together, by single linkage — one
 * blob per huddle, never one hull the size of the map.
 */
function huddles(members, reach) {
  const groups = [];
  const spoken = new Set();
  for (let i = 0; i < members.length; i++) {
    if (spoken.has(i)) continue;
    const group = [i];
    spoken.add(i);
    for (let k = 0; k < group.length; k++) {
      for (let j = 0; j < members.length; j++) {
        if (spoken.has(j)) continue;
        const a = members[group[k]], b = members[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) <= reach) { spoken.add(j); group.push(j); }
      }
    }
    groups.push(group.map(ix => members[ix]));
  }
  return groups.sort((a, b) => b.length - a.length);
}

function drawHulls(people, zoom) {
  for (const p of people) p._huddles = null;
  const fade = Math.max(0, Math.min(1, (1.5 - cam.scale) / 0.45));
  if (fade <= 0.01) return;

  const spotlight = S.litBranches.size > 0;
  for (const c of S.branches) {
    if (!S.activeBranches.has(c.id)) continue;
    const members = people.filter(p => branchesWithParents(p).includes(c.id));
    if (members.length < 2) continue;
    const emphasis = !spotlight ? 1 : S.litBranches.has(c.id) ? 1.9 : 0.35;

    const groups = huddles(members, ROW * 1.6);
    let named = false;
    groups.forEach((group, i) => {
      if (group.length > 1) for (const p of group) (p._huddles ||= []).push(`${c.id}:${i}`);
    });
    for (const group of groups) {
      if (group.length < 2) continue;
      const pts = group.map(p => w2s(p.x, p.y));
      const hull = convexHull(pts);
      if (hull.length < 2) continue;

      const pad = 30 * Math.min(1.3, cam.scale);
      const cx = hull.reduce((s, q) => s + q[0], 0) / hull.length;
      const cy = hull.reduce((s, q) => s + q[1], 0) / hull.length;
      const grown = hull.map(([x, y]) => {
        const d = Math.hypot(x - cx, y - cy) || 1;
        return [x + ((x - cx) / d) * pad, y + ((y - cy) / d) * pad];
      });

      ctx.save();
      ctx.globalAlpha = 0.1 * fade * emphasis;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      if (grown.length === 2) {
        ctx.moveTo(grown[0][0], grown[0][1]);
        ctx.lineTo(grown[1][0], grown[1][1]);
        ctx.lineWidth = pad * 2;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = c.color;
        ctx.stroke();
      } else {
        smoothClosedPath(ctx, grown);
        ctx.fill();
      }
      ctx.restore();

      if (named) continue;
      const label = `${c.emoji ? c.emoji + ' ' : ''}${c.name.toUpperCase()}`;
      const size = Math.round(13 * zoom);
      const top = grown.reduce((best, q) => (q[1] < best[1] ? q : best), grown[0]);
      const bottom = grown.reduce((best, q) => (q[1] > best[1] ? q : best), grown[0]);
      ctx.font = `800 ${size}px ${FONT_DISPLAY}`;
      const w = ctx.measureText(label).width;
      const spots = [
        [cx, top[1] - 6],
        [cx, bottom[1] + 6 + size],
        [cx - w / 2 - 10, (top[1] + bottom[1]) / 2],
        [cx + w / 2 + 10, (top[1] + bottom[1]) / 2],
      ];
      const spot = spots.find(([sx, sy]) => free(sx - w / 2, sy - size, w, size + 4));
      if (!spot) continue;
      claim(spot[0] - w / 2, spot[1] - size, w, size + 4);
      named = true;

      ctx.save();
      ctx.globalAlpha = 0.85 * fade * Math.min(1, emphasis);
      ctx.fillStyle = c.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, spot[0], spot[1]);
      ctx.restore();
    }
  }
}

function smoothClosedPath(c, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let m = mid(pts[n - 1], pts[0]);
  c.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const cur = pts[i], next = pts[(i + 1) % n];
    m = mid(cur, next);
    c.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  c.closePath();
}

/** Andrew's monotone chain. */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = list => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

// ------------------------------------------------------------------ camera

export function fitView(padding = 70) {
  camFollows = true;
  const people = visiblePeople();
  if (layoutDirty) rebuild(people);
  if (!people.length) { cam = { x: 0, y: 0, scale: 0.9 }; draw(); return; }
  const xs = people.map(p => p.tx ?? p.x), ys = people.map(p => p.ty ?? p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  cam.x = (minX + maxX) / 2;
  cam.y = (minY + maxY) / 2;
  const sx = (cv.clientWidth - padding * 2) / Math.max(1, maxX - minX);
  const sy = (cv.clientHeight - padding * 2) / Math.max(1, maxY - minY);
  cam.scale = Math.max(0.15, Math.min(1.1, Math.min(sx, sy)));
  draw();
}

export function focusPerson(id, scale = 1.1) {
  const p = S.personById[id];
  if (!p || p.x == null) return;
  camFollows = false;
  cam.x = p.tx ?? p.x; cam.y = p.ty ?? p.y;
  cam.scale = Math.max(cam.scale, scale);
  draw();
}

export function setHighlight(people, rels) {
  highlight = people ? { people: new Set(people), rels: new Set(rels || []) } : null;
  draw();
}

/**
 * One person's whole immediate world: parents, partners, children, siblings
 * and every described relationship, lit — everyone else stepping back. It
 * holds until a tap on empty ground; while it holds the map is in reading
 * mode and a finger pans.
 */
export function spotlightPerson(id) {
  const rels = relsOf(id);
  const family = [
    ...parentsOfP(id), ...spousesOfP(id), ...childrenOfP(id),
    ...parentsOfP(id).flatMap(pid => childrenOfP(pid)),   // siblings, half included
  ];
  setHighlight([id, ...family, ...rels.map(r => (r.a_id === id ? r.b_id : r.a_id))], rels.map(r => r.id));
}

/** For the smoke test, which cannot see into a canvas. */
export const hasHighlight = () => Boolean(highlight);

// ------------------------------------------------------------------ input

function localPoint(e) {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

function nodeAt(sx, sy) {
  const people = visiblePeople();
  const zoom = Math.min(1.6, Math.max(0.55, cam.scale));
  for (let i = people.length - 1; i >= 0; i--) {
    const p = people[i];
    const [x, y] = w2s(p.x, p.y);
    if (Math.hypot(x - sx, y - sy) <= radiusOf(p) * zoom + 12) return p;
  }
  return null;
}

function onDown(e) {
  if (pinch) return;
  cv.setPointerCapture?.(e.pointerId);
  const [sx, sy] = localPoint(e);
  const hit = nodeAt(sx, sy);
  pointerStart = [sx, sy];
  dragMoved = false;
  tapCandidate = hit;
  // With a spotlight held, the map is in reading mode and a finger is for
  // getting around; taps keep their meaning, rearranging waits.
  drag = hit && !highlight ? { person: hit } : { pan: true };
  clearTimeout(pressTimer);
  pressFired = false;
  if (hit) {
    pressTimer = setTimeout(() => {
      pressFired = true;
      drag = { pan: true };
      pointerStart = [sx, sy];
      spotlightPerson(hit.id);
      navigator.vibrate?.(12);
    }, 480);
  }
}

function onMove(e) {
  if (!drag || pinch) return;
  const [sx, sy] = localPoint(e);
  const dx = sx - pointerStart[0], dy = sy - pointerStart[1];
  if (!dragMoved && Math.hypot(dx, dy) < 5) return;
  dragMoved = true;
  clearTimeout(pressTimer);              // a moving finger is a drag, not a press

  if (drag.person) {
    // Lift them right out of the chart — both directions, wherever the
    // finger goes. Where they belong is decided again on release.
    const [wx, wy] = s2w(sx, sy);
    drag.person.x = wx;
    drag.person.y = wy;
    if (!looping) { looping = true; requestAnimationFrame(tick); }
  } else {
    camFollows = false;
    cam.x -= dx / cam.scale;
    cam.y -= dy / cam.scale;
    draw();
  }
  pointerStart = [sx, sy];
}

function onCancel() {
  clearTimeout(pressTimer);
  pressFired = false;
  if (drag?.person) relayout();          // snap back to where they belong
  drag = null; tapCandidate = null; dragMoved = false;
}

/**
 * Let go and the person falls back into their generation — but where they
 * landed along the row is kept: their row is renumbered in the order it now
 * reads, saved, and the layout leaves that generation alone from then on.
 * The automatic arrangement is a good guess, not an argument.
 */
async function dropPerson(person) {
  const row = (layout?.cells || []).filter(c => c.gen === person._gen);
  const keys = reorderRow(row, person.id, person.x);
  // The keys go on before the relayout, not after: the layout reads them to
  // decide the row, so setting them afterwards would draw the old order once
  // and only settle into the new one on the next redraw.
  for (const { id, key } of keys) {
    const p = S.personById[id];
    if (p) p.order_key = key;
  }
  relayout();
  // A viewer may rearrange their own screen all they like; the server would
  // only answer their save with a 403, so it is never asked.
  if (!keys.length || !['editor', 'admin'].includes(S.user?.role)) return;
  try { await api.post('/api/layout-order', keys); } catch { /* the screen is already right */ }
}

function onUp() {
  clearTimeout(pressTimer);
  if (pressFired) {
    pressFired = false;
    drag = null; tapCandidate = null; dragMoved = false;
    return;
  }
  const zooming = pinch || Date.now() - lastPinchAt < 350;
  if (drag?.person && dragMoved) {
    dropPerson(drag.person);
  } else if (tapCandidate && !dragMoved && !zooming) {
    spotlightPerson(tapCandidate.id);
    onSelect(tapCandidate.id);
  } else if (!tapCandidate && !dragMoved && !zooming && highlight) {
    setHighlight(null);
  }
  drag = null; tapCandidate = null; dragMoved = false;
}

function onWheel(e) {
  e.preventDefault();
  const [sx, sy] = localPoint(e);
  zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0016));
}

function zoomAt(sx, sy, factor) {
  camFollows = false;
  const [wx, wy] = s2w(sx, sy);
  cam.scale = Math.max(0.1, Math.min(3.2, cam.scale * factor));
  const [nx, ny] = s2w(sx, sy);
  cam.x += wx - nx;
  cam.y += wy - ny;
  draw();
}

function touchDistance(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
}

function onTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    // The first finger already armed a tap. It is a zoom now — not a tap,
    // and not a long press either.
    clearTimeout(pressTimer);
    if (drag?.person) relayout();
    drag = null; tapCandidate = null; dragMoved = false;
    lastPinchAt = Date.now();
    const r = cv.getBoundingClientRect();
    pinch = {
      dist: touchDistance(e.touches),
      cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left,
      cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top,
    };
  }
}

function onTouchMove(e) {
  if (pinch && e.touches.length === 2) {
    e.preventDefault();
    const d = touchDistance(e.touches);
    zoomAt(pinch.cx, pinch.cy, d / pinch.dist);
    pinch.dist = d;
    lastPinchAt = Date.now();
  }
}

function onTouchEnd(e) {
  if (e.touches.length < 2 && pinch) { pinch = null; lastPinchAt = Date.now(); }
}
