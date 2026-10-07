// Playwright config for story 4's persistence e2e specs (TC-19..TC-21, TC-24).
//
// Deliberately has NO shared webServer: these specs start and stop their own
// `wrangler dev` process (tests/e2e/wrangler-process.ts) per test and talk to
// the wrangler port only.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['persistence.spec.ts', 'broken-board.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // Each test starts (and sometimes restarts) a wrangler process.
  timeout: 240_000,
  use: {
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${WRANGLER_PORT}`,
  },
});
