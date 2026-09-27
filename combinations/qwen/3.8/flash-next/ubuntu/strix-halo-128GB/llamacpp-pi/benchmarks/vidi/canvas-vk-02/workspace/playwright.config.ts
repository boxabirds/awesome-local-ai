import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VIDI6_E2E_PORT ?? 8787);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Tests too slow for every commit live in the `nightly` project (TC-29, TC-30). */
const NIGHTLY_TAG = /@nightly/;

/**
 * E2E runs against `wrangler dev` serving the built client, so the same serving
 * path is used from day one. The client is built in `test` mode, which is the
 * only build that exposes the `window.__vidi6` camera hook (see design Fixtures).
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: NIGHTLY_TAG,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      grepInvert: NIGHTLY_TAG,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      grepInvert: NIGHTLY_TAG,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      // `npm run test:e2e:nightly`, and nothing else: the two tests here hold a
      // board open for minutes at a time (design: sync.e2e_nightly).
      name: 'nightly',
      grep: NIGHTLY_TAG,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
