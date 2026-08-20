// Playwright is a dev tool, not a dependency of the app — take it from
// wherever it happens to be installed: PLAYWRIGHT_PATH, a local
// node_modules, or the global lib next to the node binary.
import path from 'node:path';
import process from 'node:process';

export async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    'playwright',
    '@playwright/test',
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright', 'index.js'),
  ].filter(Boolean);
  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      return mod.default ?? mod;
    } catch { /* next */ }
  }
  return null;
}
