import { defineConfig, devices } from '@playwright/test';

/**
 * Story 4 persistence e2e (TC-19..TC-21, TC-24).
 *
 * These specs manage their OWN `wrangler dev` process per test (see
 * wrangler-process.ts): they must kill and restart the worker to prove the
 * room reloads from SQLite. That is incompatible with Playwright's shared
 * `webServer`, so this config has none, runs a single worker (one process per
 * test, serial), and points at the port the helper binds (PERSIST_PORT, 8791).
 */
export default defineConfig({
  testDir: './tests/e2e/persistence',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.PERSIST_BASE_URL ?? 'http://127.0.0.1:8791',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'persist',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
