import { defineConfig, devices } from '@playwright/test';

// E2E persistence (story 4): these specs manage their OWN `wrangler dev`
// process (with --persist-to and --var TEST_HOOKS=1) so they can kill and
// restart the worker mid-test. They therefore run without the shared
// webServer, sequentially, in chromium only. See tests/e2e/wrangler-process.ts.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /persistence\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 240_000,
  expect: { timeout: 15_000 },
  use: {
    // No fixed baseURL: each test starts its own wrangler on a unique port
    // and navigates to the returned URL.
    viewport: { width: 1280, height: 800 },
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
