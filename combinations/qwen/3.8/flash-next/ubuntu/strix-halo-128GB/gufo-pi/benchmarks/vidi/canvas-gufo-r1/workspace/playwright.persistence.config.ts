import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for persistence E2E tests (Story 4).
 * These tests manage their own wrangler dev instances, so no shared webServer.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['persistence.spec.ts', 'broken-board.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 180_000,
  use: {
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
