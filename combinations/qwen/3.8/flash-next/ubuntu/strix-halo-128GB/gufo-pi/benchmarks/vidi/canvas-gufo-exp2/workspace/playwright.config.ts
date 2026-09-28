import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against `wrangler dev` serving the test build of the client
 * (dist/client built with `--mode test`, which is what enables the
 * `window.__vidi6` test hook).
 *
 * Browser projects: Chromium by default. Firefox and WebKit projects are
 * enabled with VIDI_E2E_ALL_BROWSERS=1 (see NOTES.md: this machine only has
 * the dependencies to launch Chromium).
 */

const PORT = Number(process.env.E2E_PORT ?? 8787);
const baseURL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

type DesktopDevice = (typeof devices)['Desktop Chrome'];

const ALL: ReadonlyArray<readonly [string, DesktopDevice]> = [
  ['chromium', devices['Desktop Chrome']],
  ['firefox', devices['Desktop Firefox']],
  ['webkit', devices['Desktop WebKit']],
];

const allBrowsers = process.env.VIDI_E2E_ALL_BROWSERS === '1';
const selected = allBrowsers ? ALL : ALL.slice(0, 1);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: VIEWPORT,
    trace: 'off',
    video: 'off',
  },
  projects: selected.map(([name, device]) => ({
    name,
    use: { ...device, viewport: VIEWPORT },
  })),
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
