import { defineConfig, devices } from '@playwright/test';

// The app server is started by tests/global-setup.ts, not `webServer`,
// because persistence tests must restart it (see tests/app-server.ts).
const TEST_TIMEOUT_MS = 45_000;
const EXPECT_TIMEOUT_MS = 5_000;
// A missing control must fail fast, not burn the whole test timeout.
const ACTION_TIMEOUT_MS = 5_000;
const NAVIGATION_TIMEOUT_MS = 15_000;
const VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: EXPECT_TIMEOUT_MS },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.ACCEPT_JSON ?? 'accept-results.json' }],
  ],
  outputDir: process.env.ACCEPT_ARTIFACTS ?? 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    viewport: VIEWPORT,
    actionTimeout: ACTION_TIMEOUT_MS,
    navigationTimeout: NAVIGATION_TIMEOUT_MS,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
