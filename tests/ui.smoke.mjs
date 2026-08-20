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

  // Somebody else's perspective is a place you visit, not a state you can
  // get stuck in: the × comes home, and so does opening the app again.
  await step("another perspective is a visit, and × comes home", async () => {
    const me = await page.evaluate(async () => (await import('/js/store.js')).S.mePersonId);
    await page.click('#tabbar [data-tab="people"]');
    await page.click('#people-list .prow:has-text("Wilhelm Probe")');
    await page.waitForSelector('.sheet.show .phead');
    await page.click('.sheet.show [data-treefrom]');
    const away = await page.evaluate(async () => (await import('/js/store.js')).S.probandId);
    if (away === me) throw new Error('the tree did not move to the other perspective');

    await page.click('#proband button');
    const home = await page.evaluate(async () => (await import('/js/store.js')).S.probandId);
    if (home !== me) throw new Error(`× left the tree on ${home}, not on you (${me})`);
    const stillOffered = await page.evaluate(() =>
      document.querySelector('#proband button').textContent.includes('×'));
    if (stillOffered) throw new Error('the chip still offers a way home while already home');

    await page.reload();
    await page.waitForSelector('#app:not(.hidden)');
    const fresh = await page.evaluate(async () => (await import('/js/store.js')).S.probandId);
    if (fresh !== me) throw new Error(`opening the app read the tree from ${fresh}, not from you`);
  });

  // The force-simulation build wrote coordinates into persons.x/y. They
  // describe an arrangement that no longer exists, so a chart that starts
  // people from them opens as a heap and only tidies itself once something
  // happens to relayout it.
  await step('a saved position from the old build does not bunch the tree', async () => {
    await page.evaluate(async () => {
      const { S } = await import('/js/store.js');
      await fetch('/api/positions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(S.persons.map(p => ({ id: p.id, x: 4000, y: 4000 }))),
      });
    });
    await page.reload();
    await page.waitForSelector('#app:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(600);
    const stray = await page.evaluate(async () => {
      const { S } = await import('/js/store.js');
      return S.persons.filter(p => p.tx != null && Math.abs(p.x - p.tx) > 1)
        .map(p => `${p.name} at ${Math.round(p.x)} instead of ${Math.round(p.tx)}`);
    });
    if (stray.length) throw new Error(`on load, not where the layout puts them: ${stray.join('; ')}`);
  });

  // Dragging someone is meant to lift them right out of the chart — sideways
  // and up and down both — and then drop them back onto their own row. The
  // modules are pulled in by the same URL the app loaded them from, so this
  // reads the very state the canvas is drawing.
  await step('a dragged person lifts free and snaps back to their row', async () => {
    const id = await page.evaluate(async () => {
      const { S } = await import('/js/store.js');
      const map = await import('/js/map.js');
      map.setHighlight(null);
      const p = S.persons.find(x => x.name === 'Wilhelm Probe');
      map.focusPerson(p.id, 1.1);
      return p.id;
    });
    const settled = () => page.evaluate(async i =>
      (await import('/js/store.js')).S.personById[i].y, id);
    await page.waitForTimeout(900);                    // the camera eases in
    const before = await settled();

    const box = await (await page.$('#map')).boundingBox();
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 190, { steps: 12 });
    const lifted = await settled();
    if (Math.abs(lifted - before) < 40) {
      throw new Error(`the person did not follow the finger downwards (${before} → ${lifted})`);
    }
    await page.mouse.up();
    await page.waitForFunction(async ([i, y]) =>
      Math.abs((await import('/js/store.js')).S.personById[i].y - y) < 3, [id, before], { timeout: 5000 });
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

  // Checked the instant the shell appears, not after everything has loaded:
  // an add button a viewer sees for half a second is still an add button.
  await step('the viewer sees no editing controls, from the first frame', async () => {
    const shown = await page.evaluate(() => {
      const hidden = id => document.getElementById(id).hidden;
      return ['fab', 'btn-arrange'].filter(id => !hidden(id));
    });
    if (shown.length) throw new Error(`a viewer got ${shown.join(', ')}`);
    await page.reload();
    await page.waitForSelector('#app:not(.hidden)');
    const early = await page.evaluate(() => document.getElementById('fab').hidden);
    if (!early) throw new Error('the add button is on screen before the role is applied');
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
