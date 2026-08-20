// Not a test: seeds the fictional demo family and photographs the tree —
// phone and tablet, light and dark, Generationen and Zeit. Map work judged
// on five nodes is map work judged on the wrong problem.
//
//   node tests/busy.mjs [output-dir]     (default ./screenshots)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './pw.mjs';

const pw = await loadPlaywright();
if (!pw) { console.error('Playwright not found.'); process.exit(1); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'screenshots'));
fs.mkdirSync(OUT, { recursive: true });
const PORT = 4408;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-busy-'));

execFileSync(process.execPath, ['tools/seed-demo.mjs'], {
  cwd: ROOT, env: { ...process.env, DATA_DIR: dataDir, NODE_NO_WARNINGS: '1' }, stdio: 'inherit',
});

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const stop = code => { server.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(code); };

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  // The seed leaves no accounts, so create the admin over the API — and link
  // the account to the *seeded* Thomas instead of the duplicate person the
  // setup wizard makes, or the proband BFS starts from a person with no tree.
  const setup = await (await fetch(`${BASE}/api/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Thomas Brandt', username: 'thomas', password: 'demo-demo-demo', lang: 'de' }),
  })).json();
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'thomas', password: 'demo-demo-demo' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const auth = { 'content-type': 'application/json', cookie };
  const graph = await (await fetch(`${BASE}/api/graph`, { headers: auth })).json();
  const seededThomas = graph.persons.find(p => p.name === 'Thomas Brandt' && p.birth_year === 1965);
  await fetch(`${BASE}/api/me`, { method: 'POST', headers: auth, body: JSON.stringify({ person_id: seededThomas.id }) });
  await fetch(`${BASE}/api/persons/${setup.person_id}`, { method: 'DELETE', headers: auth });

  const browser = await pw.chromium.launch();
  const shots = [];
  for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 1180, height: 820 }]]) {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, colorScheme: scheme });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(BASE);
      await page.fill('[data-u]', 'thomas');
      await page.fill('[data-p]', 'demo-demo-demo');
      await page.click('[data-go]');
      await page.waitForSelector('#app:not(.hidden)');
      // Let the physics settle before the portrait.
      await page.waitForTimeout(3500);
      await page.click('#btn-fit');
      await page.waitForTimeout(400);
      const nameGen = `tree-gen-${device}-${scheme}.png`;
      await page.screenshot({ path: path.join(OUT, nameGen) });
      shots.push(nameGen);

      await page.click('#btn-zeit');
      await page.waitForTimeout(3000);
      await page.click('#btn-fit');
      await page.waitForTimeout(400);
      const nameZeit = `tree-zeit-${device}-${scheme}.png`;
      await page.screenshot({ path: path.join(OUT, nameZeit) });
      shots.push(nameZeit);

      if (device === 'phone' && scheme === 'light') {
        await page.click('#btn-zeit');            // back to generations
        await page.waitForTimeout(2500);
        await page.click('#tabbar [data-tab="people"]');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, 'people-phone-light.png') });
        shots.push('people-phone-light.png');
        await page.click('#tabbar [data-tab="stories"]');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, 'stories-phone-light.png') });
        shots.push('stories-phone-light.png');
        await page.click('#tabbar [data-tab="places"]');
        await page.waitForTimeout(2500);            // tiles need a moment
        await page.screenshot({ path: path.join(OUT, 'places-phone-light.png') });
        shots.push('places-phone-light.png');
      }
      if (errors.length) console.error(`[${device}/${scheme}] page errors:\n` + errors.join('\n'));
      await page.close();
    }
  }
  await browser.close();
  console.log(`Saved ${shots.length} screenshots to ${OUT}:\n  ` + shots.join('\n  '));
  stop(0);
} catch (err) {
  console.error(err);
  stop(1);
}
