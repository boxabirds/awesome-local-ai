import { defineConfig, devices } from '@playwright/test';

// Nightly e2e: long-running sync.client contract verification (idle
// stability, capacity soak with latency report). Kept out of the default
// `test:e2e` run via a separate config + `test:e2e:nightly` script, and run
// on its own port so it can run alongside (or instead of) the fast suite.
const PORT = 20611;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['nightly.spec.ts'],
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    // Hard cap on auto-waiting locators: a missing element must fail the
    // op in 5s, not hang until the test timeout (actionTimeout defaults to
    // 0 = wait forever).
    actionTimeout: 5_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npm run build:e2e && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
