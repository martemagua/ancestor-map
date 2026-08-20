// The tree canvas: a force-assisted generational layout, union bars with
// genealogy elbows, branch hulls, described relationships as thin threads,
// and the gesture layer ported from Friend-Map.
//
// The layout idea in one sentence: every person gets a *hard Y* — their
// generation row (or, in Zeit mode, their birth year) — and the physics only
// negotiates X, so the tree always reads as generations while still settling
// organically. That is also why the Zeit toggle is almost free: it is the
// same layout with a different Y function.
//
// map.js touches nothing at import time on purpose — tests/layout.test.js
// imports it under plain node and checks the layout rules without a canvas.
import { api } from './api.js';
import {
  S, colorOf, passesFilters, matchesSearch, inSpotlight, relsOf, otherEnd, relKind,
  branchesWithParents, branchesOf, parentsOfP, childrenOfP, spousesOfP,
  unionPartners, unionChildren,
} from './store.js';
import { t } from './i18n.js';

const PHYS = {
  repel: 15000, damp: 0.86, dt: 0.55, maxV: 26,
  row: 0.42,        // the hard Y — generations own the vertical axis
  union: 0.09,      // partners pull side by side
  child: 0.05,      // a child aligns under its parents' union
  rel: 0.004,       // described relationships barely tug — they are threads, not structure
  branch: 0.02,     // branch members drift together in X
  gravityX: 0.003,  // a weak pull toward the middle, X only — rows need room to breathe
};
export const ROW = 175;            // world units between generation rows
export const YEAR_PX = 3.4;        // world units per year in Zeit mode
const UNION_REST = 78;             // how close a couple stands
const FONT_BODY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_DISPLAY = '"Helvetica Neue", Helvetica, Arial, sans-serif';

let cv, ctx, dpr = 1;
let cam = { x: 0, y: 0, scale: 0.9 };
let alpha = 0, looping = false, physicsOn = true;
let drag = null, dragMoved = false, tapCandidate = null, pointerStart = null, pinch = null;
let pressTimer = null, pressFired = false;   // a long press spotlights, it never opens the card
let lastPinchAt = 0;                          // lifting two fingers fires the same pointerup a tap does
let onSelect = () => {};
let highlight = null;                         // { people:Set, rels:Set }
let saveTimer = null;
let camFollows = true;
let mode = 'gen';                             // 'gen' | 'zeit'
let showAllEdges = false;

export const allEdgesShown = () => showAllEdges;
export function setAllEdges(on) { showAllEdges = Boolean(on); draw(); }
export const layoutMode = () => mode;
export function setLayoutMode(m) { mode = m === 'zeit' ? 'zeit' : 'gen'; }

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
  const away = Math.abs(p._gen ?? 0);
  return away >= 3 ? 11 : 13;
}

// ------------------------------------------------------------------ layout rules
//
// Everything in this section is a pure function of the graph — no canvas, no
// camera — which is exactly what tests/layout.test.js checks.

/**
 * Signed generations, walked out from the proband: a parent is +1, a child
 * −1, a partner ±0. First visit wins — a marriage across generations keeps
 * the reading closest to the proband, which is the honest choice when the
 * graph genuinely disagrees with itself. Unreached people (a described-only
 * connection, an island) sit at 0 and let the physics find them a seat.
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
 * passes, so a chain of undated people still finds its place. Someone only a
 * death year knows gets a working life's guess. Whoever remains unseated
 * falls back to their generation row.
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

/** Where a person's row wants them, in the current mode. */
function yTargetOf(p, base) {
  if (mode === 'zeit' && p._year != null) return zeitY(p._year, base);
  return genY(p._gen);
}

/**
 * How much of a described-relationship thread to draw, 0..1 — same idea as
 * Friend-Map's rule: a score against a threshold that falls as you zoom in,
 * fading over a band instead of switching. The tree structure (unions,
 * children) is never thinned — it *is* the map; only the threads earn their
 * place. Exported and handed the zoom so the rule tests without a canvas.
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
  for (const p of list) {
    // One NaN coordinate poisons every neighbour's velocity within a frame.
    // New arrivals start beside their family and *on their row* — starting in
    // a heap makes the physics untangle what the rows already know.
    if (p.x == null || p.y == null || isNaN(p.x) || isNaN(p.y)) {
      const anchorId = [...parentsOfP(p.id), ...spousesOfP(p.id), ...childrenOfP(p.id)][0];
      const anchor = S.personById[anchorId];
      p.x = (anchor?.x ?? 0) + (Math.random() * 160 - 80);
      p.y = genY(p._gen) + (Math.random() * 20 - 10);
      p.vx = 0; p.vy = 0;
    }
  }
  return list;
}

/** Unions with at least one shown partner — what the bars and elbows draw. */
function visibleUnions(shownSet) {
  const out = [];
  for (const u of S.unions) {
    const partners = unionPartners(u.id).filter(id => shownSet.has(id)).map(id => S.personById[id]).filter(Boolean);
    const kids = unionChildren(u.id).filter(id => shownSet.has(id)).map(id => S.personById[id]).filter(Boolean);
    if (!partners.length || (partners.length < 2 && !kids.length)) continue;
    out.push({ u, partners, kids });
  }
  return out;
}

// ------------------------------------------------------------------ physics

function step(people) {
  const n = people.length;
  const base = mode === 'zeit' ? zeitBase(people) : 0;

  for (let i = 0; i < n; i++) {
    const a = people[i];
    for (let j = i + 1; j < n; j++) {
      const b = people[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      if (d2 > 900 * 900) continue;
      // People in the same row shove hardest — that is where seats are scarce.
      const sameRow = Math.abs(a.y - b.y) < ROW * 0.5 ? 1 : 0.35;
      const f = PHYS.repel * sameRow / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx -= fx; a.vy -= fy * 0.06;     // Y belongs to the rows; repulsion argues over X
      b.vx += fx; b.vy += fy * 0.06;
    }
  }

  const shown = new Set(people.map(p => p.id));

  // Couples stand together; children stand under the middle of their union.
  for (const { partners, kids } of visibleUnions(shown)) {
    if (partners.length === 2) {
      const [a, b] = partners;
      const dx = b.x - a.x;
      const d = Math.abs(dx) || 1;
      const f = (d - UNION_REST) * PHYS.union * Math.sign(dx);
      a.vx += f; b.vx -= f;
    }
    if (kids.length) {
      const midX = partners.reduce((s, p) => s + p.x, 0) / partners.length;
      // Children spread around the union's middle instead of piling onto it.
      const spread = (kids.length - 1) * 55;
      const ordered = [...kids].sort((a, b) => (a.birth_year ?? 9999) - (b.birth_year ?? 9999) || a.id - b.id);
      ordered.forEach((kid, i) => {
        const want = midX - spread / 2 + i * (kids.length > 1 ? spread / (kids.length - 1) : 0);
        kid.vx += (want - kid.x) * PHYS.child;
        // Parents feel their children a little too, so a branch doesn't drift
        // away from where its next generation settled.
        for (const parent of partners) parent.vx += (kid.x - parent.x) * PHYS.child * 0.15;
      });
    }
  }

  // Described relationships are threads, not structure: the faintest tug.
  for (const r of S.relationships) {
    if (!shown.has(r.a_id) || !shown.has(r.b_id)) continue;
    const a = S.personById[r.a_id], b = S.personById[r.b_id];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    a.vx += dx * PHYS.rel;
    b.vx -= dx * PHYS.rel;
  }

  // Branch members drift together in X — one pull per branch toward its
  // middle, split across memberships, exactly Friend-Map's circle force
  // turned sideways. The stored (innermost) membership pulls, not the
  // inherited one, or a sub-branch would be dragged to its parent's middle.
  const middles = new Map();
  for (const p of people) {
    for (const bid of branchesOf(p)) {
      if (!S.activeBranches.has(bid)) continue;
      const m = middles.get(bid) || [0, 0];
      m[0] += p.x; m[1]++;
      middles.set(bid, m);
    }
  }

  for (const p of people) {
    if (drag && drag.person === p) { p.vx = 0; p.vy = 0; continue; }
    if (p.id === S.probandId && mode === 'gen') {
      // The proband anchors the view: X held at 0, the row owns Y anyway.
      p.vx += (0 - p.x) * 0.1;
    }
    // The hard Y: the row (or the year) pulls far harder than anything else.
    p.vy += (yTargetOf(p, base) - p.y) * PHYS.row;
    p.vx -= p.x * PHYS.gravityX;

    const mine = branchesOf(p).filter(bid => middles.get(bid)?.[1] > 1);
    for (const bid of mine) {
      const m = middles.get(bid);
      p.vx += (m[0] / m[1] - p.x) * (PHYS.branch / mine.length);
    }

    p.vx *= PHYS.damp; p.vy *= PHYS.damp;
    const v = Math.hypot(p.vx, p.vy);
    if (v > PHYS.maxV) { p.vx = (p.vx / v) * PHYS.maxV; p.vy = (p.vy / v) * PHYS.maxV; }
    p.x += p.vx * PHYS.dt * alpha;
    p.y += p.vy * PHYS.dt * alpha;
  }
  alpha *= 0.985;
}

function tick() {
  const people = visiblePeople();
  if (physicsOn && alpha > 0.005) step(people);
  if (camFollows) followCluster(people);
  drawScene(people);
  if (physicsOn && alpha > 0.005) {
    requestAnimationFrame(tick);
  } else {
    looping = false;
    if (physicsOn) schedulePersist();
  }
}

function followCluster(people) {
  if (!people.length) return;
  let cx = 0, cy = 0;
  for (const p of people) { cx += p.x; cy += p.y; }
  cx /= people.length; cy /= people.length;
  cam.x += (cx - cam.x) * 0.08;
  cam.y += (cy - cam.y) * 0.08;
}

export function reheat(a = 0.8) {
  if (!physicsOn) return;
  alpha = Math.max(alpha, a);
  if (!looping) { looping = true; requestAnimationFrame(tick); }
}

export function setPhysics(on) {
  physicsOn = on;
  if (on) reheat(0.6); else { looping = false; persistPositions(); draw(); }
  return physicsOn;
}
export const physicsEnabled = () => physicsOn;

export function shake() {
  if (!physicsOn) setPhysics(true);
  for (const p of S.persons) {
    if (p.id === S.probandId) continue;
    p.vx += (Math.random() - 0.5) * 60;
  }
  reheat(1);
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistPositions, 1200);
}

async function persistPositions() {
  // Viewers may rearrange their own screen, but the write route is editors'
  // only — posting anyway would 403 after every settle, forever.
  if (!['editor', 'admin'].includes(S.user?.role)) return;
  const payload = S.persons.filter(p => p.x != null && !isNaN(p.x) && !isNaN(p.y))
    .map(p => ({ id: p.id, x: p.x, y: p.y }));
  if (!payload.length) return;
  try { await api.post('/api/positions', payload); } catch { /* offline is fine */ }
}

// ------------------------------------------------------------------ drawing

export function draw() {
  if (!ctx) return;
  drawScene(visiblePeople());
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

  // ---- the tree itself: union bars and child elbows. Never thinned — the
  // structure is the map. An elbow: down from the union's middle to the gap
  // between the rows, across, then down to the child.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { u, partners, kids } of visibleUnions(shown)) {
    const pts = partners.map(p => w2s(p.x, p.y));
    const anchorX = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const anchorY = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const litBar = highlight && partners.every(p => highlight.people.has(p.id));
    const dimBar = (highlight && !litBar) || partners.some(p => !inSpotlight(p));

    if (partners.length === 2) {
      ctx.save();
      ctx.globalAlpha = dimBar ? 0.12 : 0.85;
      ctx.strokeStyle = litBar ? css('--accent') : love;
      ctx.lineWidth = Math.max(1.2, 2.4 * Math.min(1.4, cam.scale));
      if (u.kind !== 'ehe') ctx.setLineDash(u.kind === 'partnerschaft' ? [] : [4, 4]);
      if (u.kind === 'partnerschaft') ctx.lineWidth *= 0.7;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
      ctx.restore();
    }

    for (const kid of kids) {
      const [kx, ky] = w2s(kid.x, kid.y);
      const lit = highlight && highlight.people.has(kid.id)
        && partners.some(p => highlight.people.has(p.id));
      const dim = (highlight && !lit) || !inSpotlight(kid) || partners.some(p => !inSpotlight(p));
      // The shelf sits in the gap between the parents' row and the child's.
      const shelfY = anchorY + (ky - anchorY) * 0.55;
      ctx.save();
      ctx.globalAlpha = dim ? 0.12 : 0.7;
      ctx.strokeStyle = lit ? css('--accent') : family;
      ctx.lineWidth = Math.max(1, 1.7 * Math.min(1.4, cam.scale));
      const role = S.children.find(c => c.union_id === u.id && c.child_id === kid.id)?.role;
      if (role && role !== 'leiblich') ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(anchorX, shelfY);
      ctx.lineTo(kx, shelfY);
      ctx.lineTo(kx, ky);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- described relationships: thin threads, earned like names.
  const edgeLabels = [];
  for (const r of S.relationships) {
    if (!shown.has(r.a_id) || !shown.has(r.b_id)) continue;
    const a = S.personById[r.a_id], b = S.personById[r.b_id];
    if (!a || !b) continue;
    const lit = highlight?.rels.has(r.id);
    const dimmed = (highlight && !lit) || !inSpotlight(a) || !inSpotlight(b);
    const room = lit || searching ? 1 : edgeRoom(r, a, b, cam.scale, showAllEdges);
    if (room <= 0.01) continue;

    const [x1, y1] = w2s(a.x, a.y), [x2, y2] = w2s(b.x, b.y);
    ctx.save();
    ctx.globalAlpha = (dimmed ? 0.1 : lit ? 1 : 0.5) * room;
    ctx.lineWidth = lit ? 3.5 : Math.max(0.8, 1.1 * Math.min(1.4, cam.scale));
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = lit ? css('--accent') : line;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();

    const reason = r.label || t('rel.' + r.kind);
    if (reason && !dimmed && (lit || labelEarned(r, a, b, cam.scale, showAllEdges))) {
      edgeLabels.push({ reason, x1, y1, x2, y2, lit, room });
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
    ctx.globalAlpha = dimmed ? 0.16 : dead ? 0.82 : 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.id === S.probandId ? ink : (colorOf(p) || css('--ungrouped') || '#9A968C');
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = paper;
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

  // ---- names, earned like Friend-Map's: scored against a threshold that
  // falls as you zoom in, and never drawn over something already there.
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
  const [, topYear] = [0, base + s2w(0, 0)[1] / YEAR_PX];
  const [, botYear] = [0, base + s2w(0, H)[1] / YEAR_PX];
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
 * blob per huddle, never one hull the size of the map. Ported verbatim.
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
  if (!people.length) { cam = { x: 0, y: 0, scale: 0.9 }; draw(); return; }
  const xs = people.map(p => p.x), ys = people.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  cam.x = (minX + maxX) / 2;
  cam.y = (minY + maxY) / 2;
  const sx = (cv.clientWidth - padding * 2) / Math.max(1, maxX - minX);
  const sy = (cv.clientHeight - padding * 2) / Math.max(1, maxY - minY);
  cam.scale = Math.max(0.25, Math.min(1.1, Math.min(sx, sy)));
  draw();
}

export function focusPerson(id, scale = 1.1) {
  const p = S.personById[id];
  if (!p || p.x == null) return;
  camFollows = false;
  cam.x = p.x; cam.y = p.y;
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
 * mode and a finger pans, exactly like Friend-Map's spotlight.
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
    const [wx] = s2w(sx, sy);
    // Dragging rearranges the row, not the generations: X follows the finger,
    // Y stays the row's. In Zeit mode the year is the truth — same rule.
    drag.person.x = wx;
    drag.person.vx = 0; drag.person.vy = 0;
    reheat(0.45);
    if (!physicsOn) draw();
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
  drag = null; tapCandidate = null; dragMoved = false;
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
    if (physicsOn) reheat(0.4);
    schedulePersist();
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
  cam.scale = Math.max(0.15, Math.min(3.2, cam.scale * factor));
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
