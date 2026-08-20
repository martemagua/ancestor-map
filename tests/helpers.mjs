// Shared test harness: spawn a real server against a throwaway data dir and
// hand back tiny HTTP helpers that track the session cookie like a browser.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ancestormap-test-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    // A timezone east of UTC, because that is where a UTC-derived date
    // silently becomes yesterday — and where half the family actually lives.
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_NO_WARNINGS: '1', TZ: 'Europe/Berlin' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${base}/healthz`); if (r.ok) break; } catch {}
    if (i === 99) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 100));
  }

  const state = { cookie: '', bearer: '' };
  const call = async (method, url, body) => {
    const init = { method, headers: {} };
    if (state.cookie) init.headers.cookie = state.cookie;
    if (state.bearer) init.headers.authorization = `Bearer ${state.bearer}`;
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(base + url, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) state.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };

  return {
    base, dataDir, state,
    GET: u => call('GET', u),
    POST: (u, b) => call('POST', u, b ?? {}),
    PUT: (u, b) => call('PUT', u, b),
    DEL: u => call('DELETE', u),
    logoutLocally: () => { state.cookie = ''; state.bearer = ''; },
    stop: () => {
      child.kill('SIGTERM');
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
