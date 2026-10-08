// Playwright config for story 10's shapes/connectors e2e specs (TC-23 to
// TC-27). Like the text config it has no shared webServer: each spec starts
// and stops its own `wrangler dev` process (tests/e2e/wrangler-process.ts)
// and talks to the wrangler port.
//
// Browsers: TC-23 (draw a shape) runs in chromium and firefox — different
// engines render pointer geometry slightly differently, so the assertions
// tolerate ±1 world unit. TC-24 (zoom/label wrap) and the collaborative
// connector tests (TC-25 to TC-27) are chromium-only. (webkit is not in the
// matrix: this host is missing the system library `libavif13` it needs and
// has no root to install it — see NOTES.md.) workers: 1 and
// fullyParallel: false keep the tests sequential, so the per-test wrangler
// process (fixed WRANGLER_PORT) never collides.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['shapes.spec.ts', 'connectors.spec.ts'],
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
      // Only the drawing spec runs in firefox; the collaborative connector
      // tests are chromium-only.
      testIgnore: ['connectors.spec.ts'],
    },
  ],
});
