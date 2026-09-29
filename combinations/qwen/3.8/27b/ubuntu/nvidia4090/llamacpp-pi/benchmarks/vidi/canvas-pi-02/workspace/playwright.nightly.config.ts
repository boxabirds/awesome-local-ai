import { defineConfig, devices } from '@playwright/test';

// Nightly e2e (task 9): long-running sync.client verification that is too
// slow for every commit — idle-connection stability (TC-29, 45 s) and
// full-capacity delivery (TC-30, 60 s). Run via `npm run test:e2e:nightly`;
// excluded from the default config via testIgnore.
//
// Served by the same path as `test:e2e` (production client build in test
// mode, so `window.__vidi6` is present) but on port 8788 so a regular e2e
// run can overlap it.
export default defineConfig({
  testDir: './tests/e2e/nightly',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 300_000,
  use: {
    baseURL: 'http://127.0.0.1:8788',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npm run build:e2e && npx wrangler dev --port 8788 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
