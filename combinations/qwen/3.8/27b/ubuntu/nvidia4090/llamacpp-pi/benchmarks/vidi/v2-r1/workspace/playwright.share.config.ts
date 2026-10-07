// Playwright config for story 5's share e2e specs (TC-26–TC-29, TC-31).
//
// Deliberately has NO shared webServer: these specs start and stop their own
// `wrangler dev` process (tests/e2e/wrangler-process.ts) per test and talk to
// the wrangler port only — like the persistence specs. The board API's real
// 404s (unknown boards, legacy boards) only exist there.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['share.spec.ts'],
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
