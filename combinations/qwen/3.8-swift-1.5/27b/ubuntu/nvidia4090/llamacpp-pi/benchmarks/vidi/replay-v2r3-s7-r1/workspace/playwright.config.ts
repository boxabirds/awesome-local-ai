import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:27952',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  // Note: the webkit (Safari) project is omitted in this environment because
  // its host dependency (libavif) cannot be installed here (no root). The
  // suite runs on chromium + firefox, which are the browsers available.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 27952 --ip 127.0.0.1 --persist-to /tmp/vidi6-e2e-persist',
    url: 'http://127.0.0.1:27952',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      TEST_HOOKS: '1',
    },
  },
});
