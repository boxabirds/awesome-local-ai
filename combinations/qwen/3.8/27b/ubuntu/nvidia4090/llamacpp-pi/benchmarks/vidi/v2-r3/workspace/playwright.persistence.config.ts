import { defineConfig } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from './src/shared/config';

/**
 * Persistence e2e project (story 4). No shared `webServer`: each test owns a
 * `wrangler dev --persist-to` process and restarts it mid-test, so the
 * process lifecycle lives in the tests (tests/e2e/wrangler-process.ts).
 *
 * The test client is built once by the global setup. Ports 29044/29045 are
 * dedicated to this project (see PORT ALLOCATION in the tasks).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/persistence-setup.ts',
  timeout: 240_000,
  expect: { timeout: E2E_EVENTUAL_TIMEOUT_MS },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:29044',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'persistence',
      testMatch: /persistence\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
  ],
});
