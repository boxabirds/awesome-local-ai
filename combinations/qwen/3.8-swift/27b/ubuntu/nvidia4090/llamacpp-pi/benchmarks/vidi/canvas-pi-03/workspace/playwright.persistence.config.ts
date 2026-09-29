import { defineConfig, devices } from '@playwright/test';

/**
 * Story 4 e2e: persistence across real `wrangler dev` process restarts and the
 * broken-board recovery flow. Each test starts/stops its own
 * `wrangler dev --persist-to <tmp>` (see helpers/wrangler-process.ts), so this
 * config has NO shared webServer — the specs own their server lifecycle.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['persistence.spec.ts', 'broken-board.spec.ts'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium-persistence',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
