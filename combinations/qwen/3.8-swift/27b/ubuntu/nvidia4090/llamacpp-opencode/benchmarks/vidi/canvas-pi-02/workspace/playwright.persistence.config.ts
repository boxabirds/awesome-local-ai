import { defineConfig } from '@playwright/test';

// Persistence e2e (story 4, TC-19 to TC-21): each test manages its own
// `wrangler dev --persist-to` process (see helpers/wrangler-process.ts) so
// the process can be killed and restarted. No shared webServer — the spec
// starts its own server on its own port with its own SQLite dir.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /persistence\.spec\.ts$/,
  timeout: 240_000,
  workers: 1,
  use: {
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
