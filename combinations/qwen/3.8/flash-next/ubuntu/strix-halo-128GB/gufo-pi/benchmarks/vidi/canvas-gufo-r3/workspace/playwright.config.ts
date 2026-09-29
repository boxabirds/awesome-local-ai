import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // The nightly soak/idle specs are slow and timing-sensitive; they run only
      // via the `nightly` project (test:e2e:nightly), never on a normal commit run.
      testIgnore: /.*nightly.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'nightly',
      testMatch: /.*nightly.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 8787 --var TEST_HOOKS:1',
    port: 8787,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
