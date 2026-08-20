// Where everyone stands. A tidy layered layout, the way genealogy charts
// have always been drawn — and deliberately *computed* rather than
// negotiated by a force simulation.
//
// Physics gave an organic map, but it has no idea that a couple belongs
// side by side or that a descent line should not cross another family: a
// stranger drifting between two spouses made the partner bar run behind
// them, and a row read as one long chain of marriages. So X is assigned
// here instead, in four steps:
//
//   1. cells   — a couple is one indivisible block, everyone else a block
//                of one, so partners can never be separated.
//   2. order   — each generation is ordered to minimise crossings, by the
//                usual median/barycentre sweeps up and down the layers.
//   3. place   — cells are packed left to right with a minimum gap, then
//                pulled toward the middle of whoever they connect to,
//                re-separated after every pull. Children end up centred
//                under their union, which is the whole point.
//   4. anchors — each union gets a point between its partners, which is
//                where its descent line starts.
//
// DOM-free and canvas-free on purpose: tests/layout.test.js checks the
// rules under plain node, and map.js only draws what comes out.

export const ROW = 190;          // world units between generation rows
const COUPLE_GAP = 96;           // between two spouses in one cell
const CELL_GAP = 62;             // between neighbouring cells
const DOT = 30;                  // nominal width of one person
const PASSES = 60;               // placement passes
const DECAY = 0.93;              // how fast each pass's step shrinks

const half = cell => (cell.people.length > 1 ? COUPLE_GAP / 2 + DOT / 2 : DOT / 2);

/** Where somebody sits inside their own cell: a lone person in the middle,
 *  a spouse half a couple-gap to their side. */
const offsetIn = (cell, i) =>
  (cell.people.length > 1 ? (i === 0 ? -COUPLE_GAP / 2 : COUPLE_GAP / 2) : 0);

/**
 * Group people into the blocks the layout moves around. A union with two
 * visible partners becomes one block; unions are taken in order of how much
 * hangs off them, so a person's main marriage wins their adjacency and a
 * remarriage is placed as a neighbour rather than tearing the first apart.
 */
export function buildCells(people, { partnersOf, childrenOf, unions }) {
  const shown = new Map(people.map(p => [p.id, p]));
  const taken = new Set();
  const cells = [];

  const ranked = [...unions].sort((a, b) =>
    (childrenOf(b.id).length - childrenOf(a.id).length)
    || ((a.started_year ?? 9999) - (b.started_year ?? 9999))
    || (a.id - b.id));

  for (const u of ranked) {
    const partners = partnersOf(u.id).filter(id => shown.has(id) && !taken.has(id));
    if (partners.length < 2) continue;
    const pair = partners.slice(0, 2).map(id => shown.get(id));
    // Same row, or it is not a couple the layout can seat side by side.
    if (pair[0]._gen !== pair[1]._gen) continue;
    for (const p of pair) taken.add(p.id);
    // Somebody who dragged one spouse past the other meant to swap them, so
    // their keys decide. Otherwise the man conventionally stands left, and
    // without a recorded sex a stable order keeps the chart from shuffling
    // between reloads.
    pair.sort((a, b) =>
      (Number.isFinite(a.order_key) && Number.isFinite(b.order_key)
        ? a.order_key - b.order_key
        : a.sex === 'm' ? -1 : b.sex === 'm' ? 1 : a.id - b.id));
    cells.push({ people: pair, gen: pair[0]._gen, union: u.id });
  }
  for (const p of people) {
    if (taken.has(p.id)) continue;
    cells.push({ people: [p], gen: p._gen, union: null });
  }
  return cells;
}

/**
 * Cell-level parent/child links for the ordering sweeps, plus the pulls that
 * place the rows.
 *
 * A pull is deliberately expressed in *seats*, not in cell centres: a child
 * who is also half of a couple has to land under their parents' descent
 * line themselves, and their spouse is 48 units to the side. Aiming the
 * couple's middle at the union anchor puts the line down beside the child,
 * which is exactly the crooked chart this rewrite is here to end. Each pull
 * therefore answers "where would my cell have to stand", already counting
 * the seat offset, and reads live positions so the passes converge.
 */
function link(cells, ctx) {
  const { unionsOf, childrenOf, parentUnionsOf, partnersOf } = ctx;
  const cellOf = new Map();
  const offsetOf = new Map();
  cells.forEach((c, i) => {
    c.index = i;
    c.people.forEach((p, k) => { cellOf.set(p.id, c); offsetOf.set(p.id, offsetIn(c, k)); });
  });
  for (const c of cells) {
    c.up = new Set(); c.down = new Set(); c.pull = [];
    c.family = null;
  }

  for (const c of cells) {
    for (const p of c.people) {
      // Down: everyone born of a union this cell's people are partners in.
      for (const uid of unionsOf(p.id)) {
        for (const kid of childrenOf(uid)) {
          const kc = cellOf.get(kid);
          if (kc && kc !== c) { c.down.add(kc); kc.up.add(c); }
        }
      }
      // Up: the partners of the union this person is a child of. The first
      // one found is also the cell's *family* — which sibling group it is
      // ordered inside. A married couple descends from two families and can
      // only stand in one of them; the person seated first takes theirs,
      // which is how a hand-drawn chart resolves it too.
      for (const uid of parentUnionsOf(p.id)) {
        for (const parent of partnersOf(uid)) {
          const pc = cellOf.get(parent);
          if (pc && pc !== c) {
            c.up.add(pc); pc.down.add(c);
            if (c.family == null) { c.family = uid; c.parent = pc; }
          }
        }
      }
    }
  }

  const seat = id => cellOf.get(id).x + offsetOf.get(id);
  for (const u of ctx.unions) {
    const partners = partnersOf(u.id).filter(id => cellOf.has(id));
    const kids = childrenOf(u.id).filter(id => cellOf.has(id));
    if (!partners.length || !kids.length) continue;
    const anchor = () => mean(partners.map(seat));      // where the line leaves
    const brood = () => mean(kids.map(seat));           // where it arrives

    // A child sitting off its parents' anchor is a visible kink in the
    // descent line, so that pull is the stronger one. An anchor sitting off
    // the middle of its brood costs nothing to look at — the shelf below it
    // simply reaches further one way — so the parents yield.
    //
    // A married couple is a child of two families and cannot stand under
    // both. Pulled equally they float halfway between and neither family's
    // sibling bar closes up, so the family they were *seated* in — the one
    // they are ordered inside — pulls harder, and the other line runs long.
    // Somebody married out; that is what it should look like.
    for (const kid of kids) {
      const c = cellOf.get(kid);
      c.pull.push({ w: c.family === u.id ? 2 : 1, at: () => anchor() - offsetOf.get(kid) });
    }

    // One pull per parent *cell*, not per parent: counted per person a couple
    // would pull twice as hard as anyone else and drag its own subtree along.
    const byCell = new Map();
    for (const id of partners) {
      const c = cellOf.get(id);
      byCell.set(c, [...(byCell.get(c) || []), offsetOf.get(id)]);
    }
    for (const [c, offsets] of byCell) c.pull.push({ w: 1, at: () => brood() - mean(offsets) });
  }
  return { cellOf, offsetOf };
}

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Order every generation so descent lines cross as little as possible.
 *
 * The usual barycentre sweep does this cell by cell, and that is what left
 * a stranger standing in the middle of somebody's children: nothing in it
 * says brothers and sisters belong next to each other, so a neighbour with
 * a slightly better average slides right through the family. Here the unit
 * being ordered is the *family* — everyone born of one union moves as a
 * block — which makes a sibling group contiguous by construction rather
 * than by luck, and there is then one sibling bar per family instead of a
 * bar with a hole in it.
 *
 * Two sweeps per pass: families follow their children on the way up, then
 * follow their parents on the way down. The downward one runs last so that
 * inside a family the children end in birth order, which is what a chart is
 * read as saying.
 *
 * A layer somebody has arranged by hand is left exactly as they left it.
 */
function order(layers, pinned) {
  const gens = [...layers.keys()].sort((a, b) => b - a);      // oldest first
  const reindex = row => row.forEach((c, i) => { c.order = i; });
  for (const g of gens) reindex(layers.get(g));

  const near = (c, side) => ([...c[side]].length ? mean([...c[side]].map(n => n.order)) : c.order);
  const families = row => {
    const groups = [];
    const byUnion = new Map();
    for (const c of row) {
      if (c.family == null) { groups.push([c]); continue; }   // nobody to stand with
      let group = byUnion.get(c.family);
      if (!group) { byUnion.set(c.family, group = []); groups.push(group); }
      group.push(c);
    }
    return groups;
  };

  const sweep = (list, side, inner) => {
    for (const g of list) {
      if (pinned.has(g)) continue;
      const groups = families(layers.get(g)).map(cells => {
        const sorted = [...cells].sort((a, b) => inner(a) - inner(b) || a.order - b.order);
        return { cells: sorted, key: mean(sorted.map(c => near(c, side))) };
      });
      groups.sort((a, b) => a.key - b.key);
      layers.set(g, groups.flatMap(x => x.cells));
      reindex(layers.get(g));
    }
  };

  for (let pass = 0; pass < 6; pass++) {
    sweep([...gens].reverse(), 'down', c => near(c, 'down'));  // follow the children
    sweep(gens, 'up', c => c.seed);                            // follow the parents
  }
}

/**
 * Push cells apart until every gap is at least CELL_GAP, keeping the order —
 * and expand around the row's own middle rather than off its left end.
 *
 * Opening a gap by walking left to right moves everything on the right and
 * nothing on the left, so the row creeps sideways a little on every pass.
 * That creep is not cosmetic: the parents above read the middle of their
 * children, follow them, and pull the children further the same way — a
 * feedback loop that walks the whole tree off to one side and never settles.
 */
function separate(row) {
  if (row.length < 2) return;
  const before = mean(row.map(c => c.x));
  for (let i = 1; i < row.length; i++) {
    const need = half(row[i - 1]) + half(row[i]) + CELL_GAP;
    if (row[i].x - row[i - 1].x < need) row[i].x = row[i - 1].x + need;
  }
  const drift = before - mean(row.map(c => c.x));
  if (drift) for (const c of row) c.x += drift;
}

/**
 * The whole thing. `yOf(person)` decides the vertical — the generation row
 * in the normal view, the birth year in Zeit mode — so both modes share one
 * horizontal arrangement and the tree keeps its shape when you switch.
 */
export function computeLayout(people, ctx) {
  const out = { people: new Map(), unions: [], cells: [] };
  if (!people.length) return out;

  const cells = buildCells(people, ctx);
  const { cellOf, offsetOf } = link(cells, ctx);

  const layers = new Map();
  for (const c of cells) {
    if (!layers.has(c.gen)) layers.set(c.gen, []);
    layers.get(c.gen).push(c);
  }
  // A generation somebody has dragged into shape is theirs; the sweeps must
  // not tidy that away underneath them.
  const pinned = new Set();
  for (const [gen, row] of layers) {
    const keys = row.map(c => Math.min(...c.people.map(p => p.order_key ?? Infinity)));
    if (keys.some(Number.isFinite)) {
      pinned.add(gen);
      row.forEach((c, i) => { c.manual = keys[i]; });
      row.sort((a, b) => (a.manual ?? Infinity) - (b.manual ?? Infinity));
    } else {
      // A stable starting point beats an arbitrary one: oldest first, then
      // by name, so the sweeps refine something already sensible.
      //
      // Anybody tied to nobody in the tree goes to the end of their row.
      // Nothing pulls them, so wherever they are first put is where they
      // stay — and parked between two families they are a wall the families
      // then have to arrange themselves around.
      const loose = c => (c.up.size + c.down.size ? 0 : 1);
      row.sort((a, b) =>
        (loose(a) - loose(b))
        || (Math.min(...a.people.map(p => p.birth_year ?? 9999)) - Math.min(...b.people.map(p => p.birth_year ?? 9999)))
        || a.people[0].name.localeCompare(b.people[0].name));
    }
    // Birth order, remembered: the sweeps shuffle families about, but inside
    // a family the children stay in the order they were born.
    row.forEach((c, i) => { c.seed = i; });
  }

  order(layers, pinned);

  // First pass: pack each row, then pull cells toward whoever they hang
  // from and re-separate. Children drift under their parents this way, and
  // parents over their children, without ever colliding.
  for (const row of layers.values()) {
    let x = 0;
    for (const c of row) { c.x = x; x += half(c) * 2 + CELL_GAP; }
  }
  const gens = [...layers.keys()].sort((a, b) => b - a);
  // The step shrinks as the passes go by, and that is what makes the
  // arrangement an answer rather than an accident. A constant step keeps
  // creeping: rows go on nudging each other outward for hundreds of passes,
  // so whatever the chart looks like is really a statement about where the
  // loop was stopped, and a family sits a little wider apart for no reason
  // anybody could point at. Decaying, the total movement is bounded, the
  // last passes barely move at all, and running it longer changes nothing.
  for (let pass = 0; pass < PASSES; pass++) {
    const step = 0.55 * DECAY ** pass;
    // Alternate the sweep direction. Walking the generations the same way
    // every time leaves each row reading positions its neighbours have not
    // caught up to yet, and that lag settles into a permanent lean.
    for (const g of (pass % 2 ? [...gens].reverse() : gens)) {
      const row = layers.get(g);
      for (const c of row) {
        if (!c.pull.length) continue;
        let sum = 0, weight = 0;
        for (const { w, at } of c.pull) { sum += at() * w; weight += w; }
        c.x += (sum / weight - c.x) * step;
      }
      // Re-sorting by x would let a pull carry a cell past its neighbour and
      // undo the crossing work; the order the sweeps settled on stands, and
      // separate() only ever pushes cells apart within it.
      separate(row);
    }
  }

  // Close the gap the drifting left behind. Somebody nothing pulls on ends
  // up wherever the rows pushed them, which can be a screen away from the
  // family — so they are walked back in until they are a normal gap from
  // their neighbour, on whichever side of the row they ended up.
  for (const row of layers.values()) {
    for (let i = 1; i < row.length; i++) {
      if (row[i].pull.length) continue;
      row[i].x = Math.min(row[i].x, row[i - 1].x + half(row[i - 1]) + half(row[i]) + CELL_GAP);
    }
    for (let i = row.length - 2; i >= 0; i--) {
      if (row[i].pull.length) continue;
      row[i].x = Math.max(row[i].x, row[i + 1].x - half(row[i]) - half(row[i + 1]) - CELL_GAP);
    }
  }

  // Centre the whole drawing on nothing in particular — the camera decides
  // what to look at, but a tree that starts at x=0 always drifts right.
  const all = [...layers.values()].flat();
  const mid = (Math.min(...all.map(c => c.x)) + Math.max(...all.map(c => c.x))) / 2;
  for (const c of all) c.x -= mid;

  for (const c of all) {
    for (const p of c.people) {
      out.people.set(p.id, { x: c.x + offsetOf.get(p.id), y: ctx.yOf(p) });
    }
  }
  out.cells = all;

  // Every union that has anything to draw gets the point its descent line
  // leaves from: between the partners, or straight under a lone parent.
  for (const u of ctx.unions) {
    const partners = ctx.partnersOf(u.id).filter(id => out.people.has(id));
    const kids = ctx.childrenOf(u.id).filter(id => out.people.has(id));
    if (!partners.length || (partners.length < 2 && !kids.length)) continue;
    const seats = partners.map(id => out.people.get(id));
    out.unions.push({
      id: u.id,
      kind: u.kind,
      x: mean(seats.map(s => s.x)),
      y: mean(seats.map(s => s.y)),
      partners,
      kids,
      lane: 0,
      lanes: 1,
    });
  }
  laneShelves(out, id => cellOf.get(id)?.gen);
  return out;
}

/**
 * Give every sibling bar in a generation its own height where it would
 * otherwise run into the one next door.
 *
 * All of them at the same fraction of the row gap is what made the chart
 * unreadable: two families' bars, side by side and exactly collinear, are
 * one long line as far as an eye is concerned, and there is then no telling
 * which children hang off which parents. So the bars are laid into lanes —
 * the classic greedy pass over intervals, which puts touching neighbours on
 * alternating heights and costs a lane only where one is really needed.
 *
 * The span is padded by a whole seat at each end, because two bars do not
 * have to actually touch to read as one — a gap narrower than the people
 * above them is not a gap the eye reports.
 */
function laneShelves(out, genOf) {
  const pad = CELL_GAP + DOT;
  const bands = new Map();
  for (const u of out.unions) {
    if (!u.kids.length) continue;
    const xs = [...u.kids.map(id => out.people.get(id).x), u.x];
    u.span = [Math.min(...xs) - pad, Math.max(...xs) + pad];
    const g = genOf(u.kids[0]);
    if (!bands.has(g)) bands.set(g, []);
    bands.get(g).push(u);
  }
  for (const band of bands.values()) {
    band.sort((a, b) => a.span[0] - b.span[0]);
    const reach = [];                       // how far right each lane is taken
    for (const u of band) {
      let lane = reach.findIndex(x => x <= u.span[0]);
      if (lane < 0) { lane = reach.length; reach.push(-Infinity); }
      reach[lane] = u.span[1];
      u.lane = lane;
    }
    const lanes = Math.max(...band.map(u => u.lane + 1));
    for (const u of band) u.lanes = lanes;
  }
}

/**
 * The order keys to save after somebody drags a person along their row:
 * whole numbers for that generation, in the order they now stand. Renumbering
 * the entire row rather than squeezing a fraction in between keeps the keys
 * from drifting into ever finer decimals over the years.
 */
export function reorderRow(cells, movedId, x) {
  const moved = cells.find(c => c.people.some(p => p.id === movedId));
  if (!moved) return [];
  const others = cells.filter(c => c !== moved).sort((a, b) => a.x - b.x);
  const at = others.findIndex(c => c.x > x);
  const ordered = at < 0 ? [...others, moved] : [...others.slice(0, at), moved, ...others.slice(at)];
  const keys = [];
  let n = 0;
  for (const c of ordered) {
    let seated = c.people;
    // Dragged past their own spouse: that is a swap, not a no-op. The couple
    // stays one block either way — only which of them stands left changes.
    if (c === moved && seated.length > 1) {
      const me = seated.find(p => p.id === movedId);
      const them = seated.find(p => p.id !== movedId);
      seated = x < c.x ? [me, them] : [them, me];
    }
    for (const p of seated) keys.push({ id: p.id, key: n++ });
  }
  return keys;
}
