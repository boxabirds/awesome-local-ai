import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright project for the persistence E2E cases (TC-19 to TC-21).
 *
 * Unlike the main config, this project has NO `webServer`: each test starts
 * and stops its own `wrangler dev --persist-to <dir>` process (via
 * tests/e2e/helpers/wrangler-process.ts) so it can kill and restart the
 * server mid-test. The client must be built first (`npm run build:e2e`) so
 * `wrangler dev` can serve the static assets.
 */
const PORT = 20615;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/persistence',
  timeout: 120_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
