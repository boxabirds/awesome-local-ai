import { existsSync } from 'node:fs';

import {
  chromium,
  defineConfig,
  devices,
  firefox,
  webkit,
  type BrowserType,
  type Project,
} from '@playwright/test';

/**
 * Device matrix for the board (design "Quality: Three device projects"): one
 * project per browser engine, all at a standard laptop viewport of 1280x800.
 *
 * A project is only declared when its browser is actually installed, so
 * `npm run test:e2e` passes on a machine that has Chromium alone (CI installs
 * the full matrix with `npx playwright install --with-deps`).
 */
const MATRIX: ReadonlyArray<{ name: string; browser: BrowserType; device: string }> = [
  { name: 'chromium', browser: chromium, device: 'Desktop Chrome' },
  { name: 'firefox', browser: firefox, device: 'Desktop Firefox' },
  { name: 'webkit', browser: webkit, device: 'Desktop Safari' },
];

const isInstalled = (browser: BrowserType): boolean => {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
};

const selected = MATRIX.filter((entry) => isInstalled(entry.browser));
const skipped = MATRIX.filter((entry) => !isInstalled(entry.browser)).map((entry) => entry.name);

if (skipped.length > 0) {
  console.log(
    `[playwright.config] skipping ${skipped.join(', ')} (browser not installed; ` +
      'run `npx playwright install --with-deps`)',
  );
}

const projects: Project[] = selected.map((entry) => ({
  name: entry.name,
  // The device preset comes first so the story's standard laptop viewport wins.
  use: { ...devices[entry.device], viewport: { width: 1280, height: 800 } },
}));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  // The built client is served by the same server as production: wrangler. The
  // build happens here so `npm run test:e2e` is self-sufficient and always runs
  // against a test-mode bundle (`window.__vidi6`, see src/client/canvas/testHooks.ts).
  webServer: {
    command: 'npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects,
});
