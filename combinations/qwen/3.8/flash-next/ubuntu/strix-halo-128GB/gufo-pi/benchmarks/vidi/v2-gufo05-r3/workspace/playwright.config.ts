import { defineConfig, devices } from '@playwright/test';

// e2e runs against `wrangler dev` serving the test build of dist/client.
// Ports are pinned inside the agent's allowed range (23616-23631).
const PORT = Number(process.env.E2E_PORT ?? 23620);
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? 23621);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
    // Playwright waits forever for an action by default, which turns a UI that
    // stopped responding into a hung run instead of a failure.
    actionTimeout: 30_000,
  },
  // Chromium always runs. Firefox and WebKit are opt-in via E2E_ALL_BROWSERS=1
  // because their browsers are installed but the host is missing OS libraries
  // (libgtk-3, libflite, ...) needed to launch them, and installing those needs
  // root (see NOTES.md). On a fully provisioned host, run:
  //   E2E_ALL_BROWSERS=1 npm run test:e2e
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    ...(process.env.E2E_ALL_BROWSERS === '1'
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
        ]
      : []),
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip ${HOST} --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
