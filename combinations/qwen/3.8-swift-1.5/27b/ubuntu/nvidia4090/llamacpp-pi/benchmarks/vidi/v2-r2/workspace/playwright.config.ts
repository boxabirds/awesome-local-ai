import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // TEST_HOOKS enables the /__test/* endpoints used by e2e specs
    // (corruption/repair, legacy board seeding). wrangler parses --var on ':'.
    command: 'npx wrangler dev --port 8787 --ip 127.0.0.1 --var TEST_HOOKS:1',
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 60000,
  },
  // Build the client once before any spec (the worker serves dist/client).
  globalSetup: './tests/e2e/global-setup.ts',
});
