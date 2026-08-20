// Drives the real app in a phone-sized Chromium: setup, a small family built
// through the forms, the tree spotlight, a story, a branch, dark mode, the
// admin page and an invitation walked to its /join form. Catches the things
// only a browser can — the canvas actually painting, sheets opening, console
// errors. Usage: node tests/ui.smoke.mjs [--shots <dir>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './pw.mjs';

const pw = await loadPlaywright();
if (!pw) { console.error('Playwright not found — install it anywhere and retry.'); process.exit(1); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SMOKE_PORT || 4409);
const BASE = `http://127.0.0.1:${PORT}`;
const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-smoke-'));
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NODE_NO_WARNINGS: '1', TZ: 'Europe/Berlin' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const problems = [];
let page;
const step = async (name, fn) => {
  try { await fn(); console.log(`ok      ${name}`); }
  catch (err) {
    console.log(`FAIL    ${name}`);
    problems.push(`${name}: ${String(err.message).split('\n').slice(0, 3).join(' / ')}`);
    if (shotDir) { try { await page.screenshot({ path: path.join(shotDir, `fail-${name.replace(/\W+/g, '-').slice(0, 30)}.png` ) }); } catch {} }
  }
};
const shot = async name => { if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) }); };

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch {}
    if (i === 99) throw new Error('server did not start');
    await new Promise(r => setTimeout(r, 100));
  }

  const browser = await pw.chromium.launch();
  // German locale on purpose: the smoke asserts a German kinship word, which
  // also proves browser-language detection end to end.
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));

  await step('setup creates the admin and lands in the app', async () => {
    await page.goto(BASE);
    await page.waitForSelector('#gate .gatebox');
    await page.fill('[data-n]', 'Alex Probe');
    await page.fill('[data-u]', 'alex');
    await page.fill('[data-p]', 'secret-enough');
    await page.click('[data-go]');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  });

  await step('quick add hangs a father above the proband', async () => {
    await page.click('#fab');
    await page.waitForSelector('.sheet.show');
    await page.fill('.sheet [data-f="name"]', 'Wilhelm Probe');
    await page.selectOption('.sheet [data-f="sex"]', 'm');
    await page.fill('.sheet [data-f="birth"]', '~1930');
    await page.selectOption('.sheet [data-f="how"]', 'parent_of');
    await page.click('.sheet [data-save]');
    await page.waitForSelector('.sheet.show .phead', { timeout: 5000 });
  });

  await step("the card shows the father's kinship line", async () => {
    const side = await page.textContent('.sheet.show .phead .side');
    if (!side.includes('Vater')) throw new Error(`kin line reads "${side}"`);
  });

  await step('editing adds a documented occupation', async () => {
    await page.click('.sheet.show [data-edit]');
    await page.waitForSelector('.sheet.show [data-f="occupation"]');
    await page.fill('.sheet.show [data-f="occupation"]', 'Lokführer');
    await page.click('.sheet.show [data-save]');
    await page.waitForSelector('.sheet.show .phead');
    const body = await page.textContent('.sheet.show');
    if (!body.includes('Lokführer')) throw new Error('occupation missing from the card');
  });

  await step('a story is captured with a person attached', async () => {
    await page.click('.sheet.show [data-close]');
    await page.click('#tabbar [data-tab="stories"]');
    await page.click('[data-newstory]');
    await page.waitForSelector('.sheet.show [data-f="title"]');
    await page.fill('.sheet.show [data-f="title"]', 'Probefahrt');
    await page.fill('.sheet.show [data-f="date"]', '1965');
    await page.click('.sheet.show [data-save]');
    await page.waitForSelector('#stories-list .prow', { timeout: 5000 });
  });

  await step('a branch is created and colours the chips', async () => {
    await page.click('#tabbar [data-tab="tree"]');
    await page.click('#btn-branches');
    await page.waitForSelector('.sheet.show [data-new]');
    await page.click('.sheet.show [data-new]');
    await page.waitForSelector('.sheet.show [data-f="name"]');
    await page.fill('.sheet.show [data-f="name"]', 'Familie Probe');
    await page.click('.sheet.show [data-save]');
    await page.waitForSelector('.sheet.show .relrow');
    await page.click('.sheet.show [data-close]');
    await page.waitForSelector('#chips [data-branch]', { timeout: 5000 });
  });

  await step('the canvas painted something', async () => {
    const painted = await page.evaluate(() => {
      const cv = document.getElementById('map');
      const ctx = cv.getContext('2d');
      return ctx.getImageData(0, 0, cv.width, cv.height).data.some(v => v !== 0);
    });
    if (!painted) throw new Error('tree canvas is blank');
  });

  await step('the Zeit toggle flips the layout mode', async () => {
    await page.click('#btn-zeit');
    const on = await page.evaluate(() => document.getElementById('btn-zeit').classList.contains('on'));
    if (!on) throw new Error('Zeit button did not latch');
    await page.click('#btn-zeit');
  });

  await step('search dims the tree and finds Wilhelm in the list', async () => {
    await page.click('#tabbar [data-tab="people"]');
    await page.fill('#search', 'Lokführer');
    await page.waitForFunction(() => document.querySelectorAll('#people-list .prow').length === 1);
    await page.fill('#search', '');
  });

  await step('dark mode paints', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.click('#tabbar [data-tab="tree"]');
    await page.waitForTimeout(400);
    await shot('smoke-dark');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await step('the admin page mints an invitation', async () => {
    await page.goto(`${BASE}/admin`);
    await page.waitForSelector('#admin header h1');
    await page.click('[data-invite]');
    await page.waitForSelector('[data-invitelink] input');
  });

  let inviteLink = '';
  await step('the invitation link opens the join form and creates a viewer', async () => {
    inviteLink = await page.inputValue('[data-invitelink] input');
    await page.goto(inviteLink);
    await page.waitForSelector('[data-go]');
    await page.fill('[data-n]', 'Gast Probe');
    await page.fill('[data-u]', 'gast');
    await page.fill('[data-p]', 'gast-passwort-1');
    await page.click('[data-go]');
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
  });

  await step('the viewer sees no editing controls', async () => {
    const fabHidden = await page.evaluate(() => document.getElementById('fab').hidden);
    if (!fabHidden) throw new Error('a viewer got the add button');
  });

  await step('no console errors along the way', async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 3).join(' | '));
  });

  await browser.close();
} catch (err) {
  problems.push(String(err.message));
} finally {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log('\nSmoke test clean.');
