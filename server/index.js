// HTTP entry point: the route table, the auth gate with roles, and a small
// static file server. The shape is Friend-Map's; the one structural change is
// that every route carries the minimum role it needs, checked here — handlers
// never re-check, and there is no client-side-only guard anywhere.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, needsSetup, BRANCH_PALETTE, metaGet, metaSet } from './db.js';
import {
  userFromRequest, userFromToken, readCookie, purgeExpiredSessions,
  checkResetToken, useResetToken, atLeast,
  createApiToken, listApiTokens, deleteApiToken, COOKIE_NAME,
} from './auth.js';
import { startBackupSchedule, runBackup, listBackups } from './backup.js';
import { getGraph, kinship, stats } from './queries.js';
import * as geo from './geo.js';
import * as R from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT || 4322);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = 8 * 1024 * 1024;   // the biggest thing anyone posts is a backup

const VERSION = {
  version: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version,
  commit: (process.env.APP_COMMIT || '').slice(0, 7) || 'dev',
  built_at: process.env.APP_BUILT_AT || null,
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const payload = type.startsWith('application/json') ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...extra,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', c => {
      if (tooBig) return;                 // keep draining, stop buffering
      size += c.length;
      if (size > MAX_BODY) {
        // Reject without destroying the socket — a torn-down connection
        // turns the 413 into a bare network error in the browser.
        tooBig = true;
        chunks.length = 0;
        reject(Object.assign(new Error('err.invalid'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (!buf.length) return resolve({});
      try { resolve(JSON.parse(buf.toString('utf8'))); }
      catch { reject(Object.assign(new Error('err.invalid'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ throttle

const attempts = new Map();   // `${ip}:${route}` → timestamps
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 12;

// `X-Forwarded-For` is whatever the client typed unless a proxy of ours is in
// front — so it only counts when the deployment says so (TRUST_PROXY=1), and
// then only the *last* entry, the one that proxy appended itself.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function clientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) {
      const parts = forwarded.split(',');
      return parts[parts.length - 1].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

const throttleKey = (req, route) => `${clientIp(req)}:${route}`;

/**
 * Guards the doors worth brute-forcing. Checking and counting are separate on
 * purpose: for login only a *wrong* password counts, so a family sharing one
 * tablet never locks itself out, while someone guessing hits the wall.
 */
function throttle(req, route) {
  const key = throttleKey(req, route);
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS);
  attempts.set(key, hits);
  if (hits.length >= MAX_ATTEMPTS) {
    throw Object.assign(new Error('err.rate_limited'), { status: 429 });
  }
}

function countAttempt(req, route) {
  const key = throttleKey(req, route);
  const now = Date.now();
  const hits = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS);
  hits.push(now);
  attempts.set(key, hits);
}

const forgiveAttempts = (req, route) => attempts.delete(throttleKey(req, route));

setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of attempts) {
    const live = hits.filter(t => now - t < WINDOW_MS);
    if (live.length) attempts.set(key, live); else attempts.delete(key);
  }
}, WINDOW_MS).unref();

// ---------------------------------------------------------------- the routes

/**
 * The whole API in one table. `role` is the minimum the caller needs:
 * 'public' works without a session, 'viewer' ≤ 'editor' ≤ 'admin' — adding a
 * route here is a security decision, exactly like PUBLIC_ROUTES was in
 * Friend-Map, with the decision spelled per line.
 */
const ROUTES = [];
const on = (method, pattern, role, handler) => ROUTES.push({ method, pattern, role, handler });

/**
 * What an API token may reach — GET only, named one by one. A token sits in
 * another machine's config file, so what it can do has to be a decision
 * somebody made: no writes, no export, no settings, no accounts.
 */
const TOKEN_ROUTES = new Set([
  '/api/session', '/api/graph', '/api/stories', '/api/relationships',
  '/api/stats', '/api/kinship', '/api/upcoming',
]);

// ---- session & accounts --------------------------------------------------
on('GET', '/api/session', 'public', ctx => R.routeSession(ctx));
on('POST', '/api/setup', 'public', ctx => R.routeSetup(ctx.body));
on('POST', '/api/login', 'public', ctx => {
  // Throttled per IP *and* username: forgiving the whole IP on any success
  // would let one valid account (an invited viewer, say) reset the counter
  // between guesses at somebody else's.
  const who = `login:${String(ctx.body.username || '').trim().toLowerCase().slice(0, 60)}`;
  throttle(ctx.req, who);
  let out;
  try {
    out = R.routeLogin(ctx.body, ctx.res, ctx.secure);
  } catch (err) {
    if (err.status === 401) countAttempt(ctx.req, who);   // only a wrong password counts
    throw err;
  }
  forgiveAttempts(ctx.req, who);
  return out;
});
on('POST', '/api/logout', 'viewer', ctx => R.routeLogout(readCookie(ctx.req, COOKIE_NAME), ctx.res));
on('POST', '/api/password', 'viewer', ctx => R.routePassword(ctx.body, ctx));
on('POST', '/api/me', 'viewer', ctx => R.routeMe(ctx.body, ctx));

// ---- password recovery ----------------------------------------------------
// There is no mailer yet (see BACKLOG.md): /api/forgot answers honestly that
// the reset happens on the machine (server/reset-password.js), and /api/reset
// consumes the tokens that CLI mints. Both throttled — they are doors.
on('POST', '/api/forgot', 'public', ctx => {
  throttle(ctx.req, 'forgot');
  countAttempt(ctx.req, 'forgot');
  return { ok: true, mail_configured: false };
});
on('GET', '/api/reset', 'public', ctx => {
  const found = checkResetToken(ctx.url.searchParams.get('token'));
  return { valid: Boolean(found), username: found?.user.username || null };
});
on('POST', '/api/reset', 'public', ctx => {
  throttle(ctx.req, 'reset');
  countAttempt(ctx.req, 'reset');
  if (String(ctx.body.password || '').length < 8) throw Object.assign(new Error('err.password_short'), { status: 400 });
  const done = useResetToken(ctx.body.token, ctx.body.password);
  if (!done) throw Object.assign(new Error('err.invite_invalid'), { status: 400 });
  return { ok: true, username: done.username };
});

// ---- invites ---------------------------------------------------------------
on('GET', '/api/invite', 'public', ctx => R.routeInviteInfo(ctx.url.searchParams.get('token')));
on('POST', '/api/invite/accept', 'public', ctx => {
  throttle(ctx.req, 'invite');
  countAttempt(ctx.req, 'invite');
  return R.routeAcceptInvite(ctx.body);
});
on('GET', '/api/invites', 'admin', () => R.routeListInvites());
on('POST', '/api/invites', 'admin', ctx => R.routeCreateInvite(ctx.body, ctx));
on('DELETE', /^\/api\/invites\/([0-9a-f]{64})$/, 'admin', ctx => R.routeDeleteInvite(ctx.params[0]));

// ---- reads -----------------------------------------------------------------
on('GET', '/api/graph', 'viewer', ctx => getGraph(ctx.user.id));
on('GET', '/api/stories', 'viewer', () => R.listStories());
on('GET', '/api/relationships', 'viewer', () => R.listRelationships());
on('GET', '/api/stats', 'viewer', () => stats());
on('GET', '/api/upcoming', 'viewer', ctx => R.upcoming(Number(ctx.url.searchParams.get('days') || 60)));
on('GET', '/api/kinship', 'viewer', ctx =>
  kinship(ctx.url.searchParams.get('from'), ctx.url.searchParams.get('to')));
on('GET', '/api/sources', 'viewer', ctx =>
  R.listSources(ctx.url.searchParams.get('type'), ctx.url.searchParams.get('id')));

// ---- persons ---------------------------------------------------------------
on('POST', '/api/persons', 'editor', ctx => R.createPerson(ctx.body, ctx.user.id));
on('POST', '/api/positions', 'editor', ctx => R.savePositions(ctx.body));
on('PUT', /^\/api\/persons\/(\d+)$/, 'editor', ctx => R.updatePerson(ctx.params[0], ctx.body, ctx.user.id));
on('PATCH', /^\/api\/persons\/(\d+)$/, 'editor', ctx => R.updatePerson(ctx.params[0], ctx.body, ctx.user.id));
on('DELETE', /^\/api\/persons\/(\d+)$/, 'editor', ctx => R.deletePerson(ctx.params[0]));

// ---- unions & children -----------------------------------------------------
on('POST', '/api/unions', 'editor', ctx => R.createUnion(ctx.body));
on('PUT', /^\/api\/unions\/(\d+)$/, 'editor', ctx => R.updateUnion(ctx.params[0], ctx.body));
on('DELETE', /^\/api\/unions\/(\d+)$/, 'editor', ctx => R.deleteUnion(ctx.params[0]));
on('POST', /^\/api\/unions\/(\d+)\/children$/, 'editor', ctx =>
  R.addChild(ctx.params[0], ctx.body.child_id, ctx.body.role));
on('POST', /^\/api\/unions\/(\d+)\/partners$/, 'editor', ctx =>
  R.addPartner(ctx.params[0], ctx.body.person_id));
on('DELETE', /^\/api\/unions\/(\d+)\/children\/(\d+)$/, 'editor', ctx =>
  R.removeChild(ctx.params[0], ctx.params[1]));

// ---- relationships ---------------------------------------------------------
on('POST', '/api/relationships', 'editor', ctx => R.upsertRelationship(ctx.body));
on('PUT', /^\/api\/relationships\/(\d+)$/, 'editor', ctx => R.updateRelationship(ctx.params[0], ctx.body));
on('DELETE', /^\/api\/relationships\/(\d+)$/, 'editor', ctx => R.deleteRelationship(ctx.params[0]));

// ---- branches ----------------------------------------------------------------
on('POST', '/api/branches', 'editor', ctx => R.createBranch(ctx.body));
on('PUT', /^\/api\/branches\/(\d+)$/, 'editor', ctx => R.updateBranch(ctx.params[0], ctx.body));
on('DELETE', /^\/api\/branches\/(\d+)$/, 'editor', ctx => R.deleteBranch(ctx.params[0]));

// ---- stories -----------------------------------------------------------------
on('POST', '/api/stories', 'editor', ctx => R.createStory(ctx.body, ctx.user.id));
on('PUT', /^\/api\/stories\/(\d+)$/, 'editor', ctx => R.updateStory(ctx.params[0], ctx.body));
on('DELETE', /^\/api\/stories\/(\d+)$/, 'editor', ctx => R.deleteStory(ctx.params[0]));

// ---- sources -----------------------------------------------------------------
on('POST', '/api/sources', 'editor', ctx => R.createSource(ctx.body));
on('DELETE', /^\/api\/sources\/(\d+)$/, 'editor', ctx => R.deleteSource(ctx.params[0]));
on('POST', /^\/api\/sources\/(\d+)\/link$/, 'editor', ctx =>
  R.linkSource(ctx.params[0], ctx.body.type, ctx.body.id));
on('DELETE', /^\/api\/sources\/(\d+)\/link$/, 'editor', ctx =>
  R.unlinkSource(ctx.params[0], ctx.url.searchParams.get('type'), ctx.url.searchParams.get('id')));

// ---- places ------------------------------------------------------------------
on('GET', '/api/geo/search', 'viewer', async ctx =>
  ({ hits: await geo.search(ctx.url.searchParams.get('q') || '') }));
on('GET', '/api/geo/places', 'viewer', () => geo.places());
// The fallback for browsers that refuse to send a Referer — see geo.js.
on('GET', /^\/api\/geo\/tile\/(\d+)\/(\d+)\/(\d+)$/, 'viewer', async ctx => {
  const image = await geo.tile(ctx.params[0], ctx.params[1], ctx.params[2]);
  return raw(image.body, { 'Cache-Control': 'private, max-age=604800' }, image.mime);
});
on('POST', '/api/geo/backfill', 'editor', async ctx => {
  // Capped: at one lookup a second, an unbounded batch would hold the
  // connection open for as long as the family is big.
  const max = Math.min(50, Math.max(1, Number(ctx.body.max) || 20));
  return geo.backfill(max);
});

// ---- API tokens (your own account's, whatever your role) --------------------
on('GET', '/api/tokens', 'viewer', ctx => listApiTokens(ctx.user.id));
on('POST', '/api/tokens', 'viewer', ctx => createApiToken(ctx.user.id, ctx.body.name));
on('DELETE', /^\/api\/tokens\/(\d+)$/, 'viewer', ctx => deleteApiToken(ctx.params[0], ctx.user.id));

// ---- administration ----------------------------------------------------------
on('GET', '/api/users', 'admin', () => R.routeListUsers());
on('POST', '/api/users', 'admin', ctx => R.routeCreateUser(ctx.body));
on('PUT', /^\/api\/users\/(\d+)$/, 'admin', ctx => R.routeUpdateUser(ctx.params[0], ctx.body, ctx));
on('DELETE', /^\/api\/users\/(\d+)$/, 'admin', ctx => R.routeDeleteUser(ctx.params[0], ctx));
on('GET', '/api/export', 'admin', ctx => {
  const stamp = new Date().toISOString().slice(0, 10);
  return raw(R.exportAll(), { 'Content-Disposition': `attachment; filename="ancestormap-${stamp}.json"` });
});
on('GET', '/api/export/gedcom', 'admin', async ctx => {
  const { exportGedcom } = await import('./gedcom.js');
  const stamp = new Date().toISOString().slice(0, 10);
  return raw(exportGedcom(),
    { 'Content-Disposition': `attachment; filename="ancestormap-${stamp}.ged"` },
    'text/plain; charset=utf-8');
});
on('POST', '/api/import', 'admin', ctx => R.importAll(ctx.body.data || ctx.body, { replace: ctx.body.replace === true }));
on('GET', '/api/backups', 'admin', () => listBackups());
on('POST', '/api/backups', 'admin', () => runBackup('manual'));
on('GET', '/api/duplicates', 'admin', () => R.findDuplicates());
on('POST', '/api/persons/merge', 'admin', ctx => R.mergePersons(ctx.body));

// ---- settings ----------------------------------------------------------------
on('GET', '/api/settings', 'viewer', () => ({
  branch_palette: BRANCH_PALETTE,
  map: { tile_url: metaGet('tile_url', '') },
  build: VERSION,
}));
on('POST', '/api/settings/map', 'admin', ctx => {
  const tile = String(ctx.body.tile_url || '').trim();
  if (tile && !/^https?:\/\/\S+\{z\}\S*\{x\}\S*\{y\}/.test(tile)) {
    throw Object.assign(new Error('err.invalid'), { status: 400 });
  }
  metaSet('tile_url', tile);
  return { tile_url: metaGet('tile_url', '') };
});

/** For the two answers that are not plain JSON-with-200. */
const raw = (body, extra = {}, type = 'application/json; charset=utf-8', code = 200) =>
  ({ __raw: { code, body: type.startsWith('application/json') ? body : body, type, extra } });

// ------------------------------------------------------------------ dispatch

const ROLE_OK = (user, role) => role === 'public' || atLeast(user, role);

function matchRoute(method, pathname) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    if (typeof r.pattern === 'string') {
      if (r.pattern === pathname) return { route: r, params: [] };
    } else {
      const m = r.pattern.exec(pathname);
      if (m) return { route: r, params: m.slice(1) };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  // Trust the proxy's scheme header only for deciding whether to mark the
  // cookie Secure — never for anything security-relevant.
  const secure = req.headers['x-forwarded-proto'] === 'https';

  try {
    if (p === '/healthz') return send(res, 200, { ok: true, uptime: Math.round(process.uptime()), ...VERSION });

    // The MCP endpoint: JSON-RPC for AI agents, authenticated by API token
    // only — no cookies, so a page in a browser can never reach it by
    // accident, and the tools behind it are read-only by construction.
    if (p === '/mcp') {
      if (req.method !== 'POST') return send(res, 405, { error: 'err.invalid' });
      const agent = userFromToken(req);
      if (!agent) return send(res, 401, { error: 'err.unauthorized' });
      const { handleMcp } = await import('./mcp.js');
      const out = handleMcp(await readBody(req), agent);
      if (out === null) { res.writeHead(202); return res.end(); }
      return send(res, 200, out);
    }

    const isApi = p.startsWith('/api/');
    if (!isApi) {
      if (p === '/admin' || p === '/admin/') return servePage('admin.html', res);
      if (p === '/reset' || p === '/reset/') return servePage('reset.html', res);
      if (p === '/join' || p === '/join/') return servePage('join.html', res);
      return serveStatic(p, req, res);
    }

    const found = matchRoute(req.method, p);
    if (!found) return send(res, 404, { error: 'err.notfound' });

    // A browser brings a cookie; another machine brings a token. A token
    // stands in for its account, but only on the GET routes named above.
    const session = userFromRequest(req);
    const byToken = session ? null : userFromToken(req);
    const user = session || byToken;

    if (found.route.role !== 'public') {
      if (!user) return send(res, 401, { error: 'err.unauthorized' });
      if (byToken && !(req.method === 'GET' && TOKEN_ROUTES.has(p))) {
        return send(res, 403, { error: 'err.forbidden' });
      }
      if (!ROLE_OK(user, found.route.role)) return send(res, 403, { error: 'err.forbidden' });
    }

    const needsBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
    const ctx = {
      req, res, url, secure, user,
      params: found.params,
      body: needsBody ? await readBody(req) : {},
    };
    const out = await found.route.handler(ctx);
    if (out && out.__raw) {
      const { code, body, type, extra } = out.__raw;
      return send(res, code, body, type, extra);
    }
    return send(res, 200, out);
  } catch (err) {
    // Errors we raised ourselves carry a status and an i18n key meant for a
    // toast. Anything else is ours to fix, not theirs to read.
    if (err.status) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'err.unexpected' });
  }
});

function servePage(file, res) {
  const full = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(full)) return send(res, 404, { error: 'err.notfound' });
  return send(res, 200, fs.readFileSync(full), MIME['.html'], { 'Cache-Control': 'no-cache' });
}

function serveStatic(pathname, req, res) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // Unknown paths fall back to the shell so client-side routing works.
    const shell = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(shell)) return send(res, 200, fs.readFileSync(shell), MIME['.html'], { 'Cache-Control': 'no-cache' });
    return send(res, 404, { error: 'err.notfound' });
  }
  // `no-cache` means "ask me first", not "don't keep it": the browser
  // revalidates and an unchanged file comes back as an empty 304 — so an
  // update on the server reaches every browser on the next load.
  const stat = fs.statSync(full);
  const etag = `W/"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  const ext = path.extname(full);
  return send(res, 200, fs.readFileSync(full), MIME[ext] || 'application/octet-stream',
    { 'Cache-Control': 'no-cache', ETag: etag });
}

purgeExpiredSessions();
setInterval(purgeExpiredSessions, 12 * 3600_000).unref();
startBackupSchedule();

server.listen(PORT, HOST, () => {
  console.log(`Ancestor Map running on http://${HOST}:${PORT}`);
  if (needsSetup()) console.log('→ No account yet. Open it in a browser and finish the setup.');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n${sig} — shutting down.`);
    server.close(() => { try { db.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
