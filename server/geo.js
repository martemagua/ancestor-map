// Address lookup via Nominatim (OpenStreetMap) — ported from Friend-Map.
//
// This goes through the server rather than straight from the browser for
// three reasons, all of them Nominatim's usage policy: a request needs a
// User-Agent that identifies the app (a browser will not let us set one), no
// more than one request per second across the whole installation, and
// results have to be cached instead of asked for again. One throttle and one
// cache here covers every phone in the family.
import { db, metaGet } from './db.js';

// Overridable so the tests can answer for it, and so a household running its
// own Nominatim can point at that instead.
const ENDPOINT = () => process.env.NOMINATIM_URL
  || metaGet('nominatim_url', '') || 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = Number(process.env.NOMINATIM_GAP_MS || 1100);   // one per second, with slack
const TIMEOUT_MS = 8_000;
const CACHE_TTL_DAYS = 180;

const MAX_WAITING = 12;
let lastCallAt = 0;
let waiting = 0;
let queue = Promise.resolve();

/** Identifies us to Nominatim, as their policy requires. */
function userAgent() {
  const url = metaGet('public_url', '') || 'self-hosted';
  return `AncestorMap/0.1 (+${url})`;
}

const normalise = q => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fail = (key, status) => Object.assign(new Error(key), { status });

function cacheGet(q) {
  const row = db.prepare(
    `SELECT result FROM geocache WHERE q=? AND at > datetime('now', ?)`,
  ).get(q, `-${CACHE_TTL_DAYS} days`);
  if (!row) return null;
  try { return JSON.parse(row.result); } catch { return null; }
}

const cachePut = (q, hits) => db.prepare(
  `INSERT OR REPLACE INTO geocache (q,result,at) VALUES (?,?,datetime('now'))`,
).run(q, JSON.stringify(hits));

/**
 * Every outbound call lines up behind the last one, at most one per second.
 * Past a dozen waiters the honest answer is "ask again" rather than a
 * request that resolves in half a minute.
 */
function throttled(fn) {
  if (waiting >= MAX_WAITING) throw fail('err.geo_busy', 429);
  waiting++;
  const mine = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fn();
  }).finally(() => { waiting--; });
  queue = mine.catch(() => {});          // keep the chain alive when a call blows up
  return mine;
}

function tidy(hit) {
  const a = hit.address || {};
  const town = a.city || a.town || a.village || a.municipality || a.county || '';
  return {
    label: hit.display_name || '',
    // What lands in the field: short enough to read on a phone. Genealogy
    // places are usually towns, so town + region + country reads right.
    short: [town || a.hamlet || a.suburb, a.state, a.country].filter(Boolean).join(', ')
      || (hit.display_name || '').split(',').slice(0, 3).join(',').trim(),
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    kind: hit.type || '',
  };
}

/** Places matching a query, best first. Cached; at most one call per second. */
export async function search(query, limit = 5) {
  const q = normalise(query);
  if (q.length < 3) return [];

  const hit = cacheGet(q);
  if (hit) return hit.slice(0, limit);

  const url = `${ENDPOINT()}?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=8`;

  const hits = await throttled(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw fail('err.geo_down', 502);
    }
    if (res.status === 429) throw fail('err.geo_busy', 429);
    if (!res.ok) throw fail('err.geo_down', 502);
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .map(tidy)
      .filter(h => Number.isFinite(h.lat) && Number.isFinite(h.lon));
  });

  cachePut(q, hits);
  return hits.slice(0, limit);
}

/**
 * Fill in coordinates for places that were typed before any of this existed —
 * birth places and death places both. Capped per call: at one request a
 * second, hundreds in one go would hold the connection open for minutes.
 */
export async function backfill(max = 20) {
  const jobs = [
    ...db.prepare(`SELECT id, birth_place AS place FROM persons
      WHERE archived=0 AND birth_place<>'' AND birth_lat IS NULL`).all()
      .map(r => ({ ...r, latCol: 'birth_lat', lonCol: 'birth_lon' })),
    ...db.prepare(`SELECT id, death_place AS place FROM persons
      WHERE archived=0 AND death_place<>'' AND death_lat IS NULL`).all()
      .map(r => ({ ...r, latCol: 'death_lat', lonCol: 'death_lon' })),
  ];

  const done = [];
  for (const job of jobs.slice(0, max)) {
    let hits = [];
    try { hits = await search(job.place, 1); } catch { break; }   // stop on the first refusal
    // A miss stays null rather than being marked done, so a corrected place
    // gets another try later.
    if (!hits.length) continue;
    db.prepare(`UPDATE persons SET ${job.latCol}=?, ${job.lonCol}=? WHERE id=?`)
      .run(hits[0].lat, hits[0].lon, job.id);
    done.push({ id: job.id, place: job.place, label: hits[0].short });
  }

  const left = db.prepare(`SELECT
      (SELECT COUNT(*) FROM persons WHERE archived=0 AND birth_place<>'' AND birth_lat IS NULL)
    + (SELECT COUNT(*) FROM persons WHERE archived=0 AND death_place<>'' AND death_lat IS NULL) c`).get().c;
  return { done, left, total: jobs.length };
}

/** Everything that sits somewhere, for the Orte map. */
export function places() {
  const births = db.prepare(`SELECT id, name, birth_place AS place, birth_year AS year,
      birth_lat AS lat, birth_lon AS lon FROM persons
    WHERE archived=0 AND birth_lat IS NOT NULL AND birth_lon IS NOT NULL`).all();
  const deaths = db.prepare(`SELECT id, name, death_place AS place, death_year AS year,
      death_lat AS lat, death_lon AS lon FROM persons
    WHERE archived=0 AND death_lat IS NOT NULL AND death_lon IS NOT NULL`).all();
  const stories = db.prepare(`SELECT id, title, kind, date, date_year AS year, place, lat, lon
    FROM stories WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY date_year`).all();
  return { births, deaths, stories };
}

/** Where the browser gets its map tiles. Configurable, as the OSM policy asks. */
export const tileUrl = () =>
  metaGet('tile_url', '') || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// ------------------------------------------------------------------ tiles

const TILE_CACHE_BYTES = 32 * 1024 * 1024;
const tileCache = new Map();          // "z/x/y" → { mime, body }
const tilePending = new Map();        // "z/x/y" → promise, in-flight fetches
let tileBytes = 0;

/**
 * A single tile, fetched by us instead of by the browser — the fallback for
 * browsers that strip the cross-origin Referer OSM requires. The browser is
 * the normal path and stays that way; here we can send the User-Agent the
 * policy asks for, and cache what comes back.
 */
export async function tile(z, x, y) {
  const [zoom, col, row] = [z, x, y].map(Number);
  const span = 2 ** zoom;
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 19
    || !Number.isInteger(col) || !Number.isInteger(row)
    || col < 0 || col >= span || row < 0 || row >= span) {
    throw fail('err.notfound', 404);
  }

  const key = `${zoom}/${col}/${row}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  // Two phones panning the same corner ask for the same tiles at the same
  // moment; sharing the in-flight fetch spares the tile server a request.
  if (tilePending.has(key)) return tilePending.get(key);

  const load = (async () => {
    const url = tileUrl().replace('{z}', zoom).replace('{x}', col).replace('{y}', row);
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': userAgent(), Accept: 'image/*' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw fail('err.geo_down', 502);
    }
    if (!res.ok) throw fail('err.geo_down', 502);

    const image = {
      mime: res.headers.get('content-type') || 'image/png',
      body: Buffer.from(await res.arrayBuffer()),
    };
    tileCache.set(key, image);
    tileBytes += image.body.length;
    while (tileBytes > TILE_CACHE_BYTES && tileCache.size > 1) {
      const oldest = tileCache.keys().next().value;
      tileBytes -= tileCache.get(oldest).body.length;
      tileCache.delete(oldest);
    }
    return image;
  })().finally(() => tilePending.delete(key));
  tilePending.set(key, load);
  return load;
}
