import { defineConfig, devices } from '@playwright/test';

// This agent's servers must listen on a port from $AGENT_PORT_FIRST..
// $AGENT_PORT_LAST; fall back to the historical default elsewhere.
const E2E_PORT = Number(process.env.AGENT_PORT_FIRST ?? 8787);
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: E2E_BASE_URL,
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
    command: `npx wrangler dev --port ${E2E_PORT} --ip 127.0.0.1 --persist-to /tmp/vidi6-e2e-persist`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: {
      TEST_HOOKS: '1',
    },
  },
});
