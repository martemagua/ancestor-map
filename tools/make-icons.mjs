#!/usr/bin/env node
// Renders public/icons/icon.svg into the raster sizes Android's install
// prompt requires (192, 512, maskable 512, apple-touch 180), using whatever
// Playwright/Chromium is around — a dev tool, not a dependency.
//   node tools/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from '../tests/pw.mjs';

const pw = await loadPlaywright();
if (!pw) { console.error('Playwright not found.'); process.exit(1); }

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = fs.readFileSync(path.join(ICONS, 'icon.svg'), 'utf8');

const browser = await pw.chromium.launch();
const jobs = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-180.png', 180, 0],
  // Maskable: the safe zone is an inset circle, so the artwork shrinks into
  // the middle and the brand colour fills the bleed.
  ['icon-maskable-512.png', 512, 96],
];
for (const [name, size, pad] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = size - pad * 2;
  await page.setContent(`<body style="margin:0;background:#A6743C">
    <div style="padding:${pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
  </body>`);
  await page.screenshot({ path: path.join(ICONS, name) });
  await page.close();
  console.log(`${name}  ${size}×${size}`);
}
await browser.close();
