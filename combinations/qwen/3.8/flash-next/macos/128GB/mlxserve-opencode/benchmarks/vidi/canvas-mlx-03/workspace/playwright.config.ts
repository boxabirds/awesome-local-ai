import { defineConfig, devices } from '@playwright/test';

const PORT = 5178;
const BASE_URL = `http://localhost:${PORT}`;

// The e2e app is served the same way it will be in production: a built static
// client served by `wrangler dev`. We build in test mode so the window.__vidi6
// camera hook is available to jump far away (TC-26, TC-27).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
});
