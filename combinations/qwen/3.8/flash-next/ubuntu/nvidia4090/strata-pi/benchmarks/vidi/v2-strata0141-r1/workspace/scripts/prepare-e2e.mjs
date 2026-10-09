/**
 * Workaround for this sandbox: Playwright's own browser downloads are blocked
 * (only the npm registry is reachable), and the preinstalled Playwright browsers
 * were pruned. Resolve which browsers `npm run test:e2e` can actually launch and
 * write the answer to `.e2e/browser.json` for `playwright.config.ts` to read.
 *
 * Order:
 *   1. Playwright's installed browsers, if any.
 *   2. Otherwise, the Chromium build shipped inside the `@sparticuz/chromium`
 *      npm package (a real Chromium binary, no download needed).
 */
import { chromium, firefox, webkit } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const candidates = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

const out = { browsers: [], executablePaths: {} };

for (const [name, browser] of candidates) {
  try {
    if (existsSync(browser.executablePath())) {
      out.browsers.push(name);
    }
  } catch {
    // Browser metadata not available on this machine.
  }
}

if (!out.browsers.includes('chromium')) {
  try {
    const mod = await import('@sparticuz/chromium');
    const fallback = mod.default ?? mod;
    const path = await fallback.executablePath();
    if (existsSync(path)) {
      out.browsers.push('chromium');
      out.executablePaths.chromium = path;
      console.log(`using @sparticuz/chromium as the Chromium executable: ${path}`);
    }
  } catch (error) {
    console.warn(`no usable Chromium found: ${error instanceof Error ? error.message : error}`);
  }
}

if (out.browsers.length === 0) {
  console.warn('no browser available for e2e tests');
}

mkdirSync('.e2e', { recursive: true });
writeFileSync('.e2e/browser.json', `${JSON.stringify(out, null, 2)}\n`);
console.log(`e2e browsers: ${out.browsers.join(', ') || 'none'}`);
