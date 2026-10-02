import { defineConfig, devices } from '@playwright/test';

// All servers must use ports from $AGENT_PORT_FIRST..$AGENT_PORT_LAST.
const PORT = Number(process.env.AGENT_PORT_FIRST ?? 29056);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
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
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --persist-to /tmp/vidi6-e2e-persist`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      TEST_HOOKS: '1',
    },
  },
});
