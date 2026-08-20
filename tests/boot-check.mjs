// Quick dev sanity check, not part of `npm test`: boots the server, walks
// setup → login → tabs in a real Chromium, and fails on any console error.
// The full walkthrough lives in tests/ui.smoke.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './pw.mjs';

const chromiumPkg = await loadPlaywright();
if (!chromiumPkg) { console.error('Playwright not found — skipping.'); process.exit(0); }
const { chromium } = chromiumPkg;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4407;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-boot-'));
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'inherit', 'inherit'],
});

const stop = code => { server.kill('SIGTERM'); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(code); };

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(BASE);
  await page.waitForSelector('#gate .gatebox');
  await page.fill('[data-n]', 'Alex Test');
  await page.fill('[data-u]', 'alex');
  await page.fill('[data-p]', 'secret-enough');
  await page.click('[data-go]');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });

  for (const tab of ['people', 'stories', 'places', 'tree']) {
    await page.click(`#tabbar [data-tab="${tab}"]`);
    await page.waitForTimeout(150);
  }
  // Open quick add, create a person, open their card.
  await page.click('#fab');
  await page.waitForSelector('.sheet.show');
  await page.fill('.sheet [data-f="name"]', 'Wilhelm Test');
  await page.fill('.sheet [data-f="birth"]', '~1890');
  await page.click('.sheet [data-save]');
  await page.waitForSelector('.sheet.show .phead', { timeout: 5000 });

  // The admin page: create an invite and walk its link to the join form.
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('#admin header h1');
  await page.click('[data-invite]');
  await page.waitForSelector('[data-invitelink] input');
  const inviteLink = await page.inputValue('[data-invitelink] input');
  await page.goto(inviteLink);
  await page.waitForSelector('[data-go]');
  await page.fill('[data-u]', 'gast');
  await page.fill('[data-p]', 'gast-passwort-1');
  await page.fill('[data-n]', 'Gast Test');
  await page.click('[data-go]');
  await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });

  await browser.close();
  if (errors.length) {
    console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
    stop(1);
  }
  console.log('boot-check OK — setup, tabs, quick add, person card all clean.');
  stop(0);
} catch (err) {
  console.error(err);
  stop(1);
}
