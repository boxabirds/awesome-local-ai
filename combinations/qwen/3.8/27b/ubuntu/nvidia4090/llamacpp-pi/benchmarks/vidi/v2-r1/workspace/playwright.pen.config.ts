// Playwright config for story 11's pen e2e spec (TC-17 to TC-20). Like the
// shapes config it has no shared webServer: each spec starts and stops its
// own `wrangler dev` process (tests/e2e/wrangler-process.ts) and talks to the
// wrangler port.
//
// Browsers: TC-17 (draw + live preview) runs in chromium and firefox —
// different engines render pointer geometry slightly differently, so the
// assertions tolerate ±2 world units. TC-18 to TC-20 (collaborative sharing,
// navigation and resize) are chromium-only. (webkit is not in the matrix:
// this host is missing the system library `libavif13` it needs and has no
// root to install it — see NOTES.md.) workers: 1 and fullyParallel: false
// keep the tests sequential, so the per-test wrangler process (fixed
// WRANGLER_PORT) never collides.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['pen.spec.ts'],
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
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'firefox',
      use: { browserName: 'firefox' },
      // Only the drawing spec (TC-17) runs in firefox; the collaborative and
      // resize tests skip themselves (chromiumOnly).
    },
  ],
});
