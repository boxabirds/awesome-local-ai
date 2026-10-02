import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:22896',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
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
    command: 'npx wrangler dev --port 22896 --ip 127.0.0.1 --persist-to /tmp/vidi6-e2e-persist',
    url: 'http://127.0.0.1:22896',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      TEST_HOOKS: '1',
    },
  },
});
