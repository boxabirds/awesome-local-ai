import { defineConfig, devices } from '@playwright/test';
import { PERSIST_URL } from './tests/e2e/helpers/wrangler-process';

/**
 * Story 4 persistence e2e (TC-19..TC-21) + story 5 share e2e (TC-26..TC-31).
 *
 * Unlike the main config there is NO shared webServer: each test drives its
 * own `wrangler dev --persist-to <tmp dir>` process
 * (tests/e2e/helpers/wrangler-process.ts) so it can kill and restart the
 * real serving process mid-test. That requires a fixed port and one
 * worker at a time, hence the single chromium project.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // share.spec.ts (story 5) also runs here: it targets PERSIST_URL and drives
  // its own wrangler process(es) — TC-30 needs the real rate limiter that only
  // wrangler.jsonc provides.
  testMatch: ['persist.spec.ts', 'share.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: 'list',
  // Build the test-mode client bundle (window.__vidi6 hooks) once up front;
  // wrangler serves dist/client.
  globalSetup: './tests/e2e/persist-global-setup.ts',
  use: {
    baseURL: PERSIST_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
