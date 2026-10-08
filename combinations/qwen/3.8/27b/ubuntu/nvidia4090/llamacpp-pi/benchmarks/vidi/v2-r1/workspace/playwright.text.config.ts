// Playwright config for story 9's free-text e2e specs (TC-26 to TC-31). Like
// the undo/selection configs it has no shared webServer: each spec starts and
// stops its own `wrangler dev` process (tests/e2e/wrangler-process.ts) and
// talks to the wrangler port.
//
// Browsers: every test runs in chromium; TC-26 (long-annotation wrapping) also
// runs in firefox — different engines measure text slightly differently, so
// the assertions tolerate ±2 world units. (webkit is not in the matrix: this
// host is missing the system library `libavif13` it needs and has no root to
// install it — see NOTES.md.) workers: 1 and fullyParallel: false keep the
// tests sequential, so the per-test wrangler process (fixed WRANGLER_PORT)
// never collides.

import { defineConfig } from '@playwright/test';
import { WRANGLER_PORT } from './tests/e2e/wrangler-process';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: ['text.spec.ts'],
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
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
