// Playwright config for story 7's multi-context collaboration specs
// (TC-35, TC-36). Like the persistence config, it deliberately has no shared
// webServer: the specs start and stop their own `wrangler dev` process
// (tests/e2e/wrangler-process.ts) per test and talk to the wrangler port.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['selection-collab.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // Each test starts (and stops) a wrangler process.
  timeout: 240_000,
  use: {
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${WRANGLER_PORT}`,
  },
});
