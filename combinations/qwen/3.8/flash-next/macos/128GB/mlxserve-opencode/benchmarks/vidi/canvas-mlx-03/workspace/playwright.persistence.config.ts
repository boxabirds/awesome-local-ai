import { defineConfig, devices } from '@playwright/test';

// Story 4's persistence specs cannot use the shared webServer: they must own the
// `wrangler dev` process (start it, kill it, start it again over the same
// --persist-to directory). So this config has NO webServer — each test boots its
// own server on a free port through tests/e2e/helpers/wrangler-process.ts, and
// globalSetup builds the client bundle those servers serve.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /persistence\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 420000,
  globalSetup: './tests/e2e/helpers/build-client.ts',
  use: {
    // Unused: every navigation is absolute, because the port is chosen per test.
    baseURL: 'http://127.0.0.1:1',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
