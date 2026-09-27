import { defineConfig, devices } from '@playwright/test';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } },
    },
  ],
  webServer: {
    command: `npm run build:e2e && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
