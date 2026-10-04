import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright project for the broken-board E2E case (TC-24). Each test starts
 * its own `wrangler dev --persist-to <dir>` process (no shared webServer) —
 * one with TEST_HOOKS=1 (to drive the /__test/ corrupt/repair hooks) and one
 * without (to verify the hooks are absent from a normal build). The client
 * must be built first (`npm run build:e2e`).
 */
const PORT = 20616;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/broken-board',
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
