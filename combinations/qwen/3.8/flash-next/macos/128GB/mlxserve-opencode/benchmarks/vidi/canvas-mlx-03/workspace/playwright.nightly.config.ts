import { defineConfig, devices } from '@playwright/test';

const PORT = 5178;
const BASE_URL = `http://localhost:${PORT}`;

// Nightly e2e (design TC-29 idle stability, TC-30 capacity soak). These are
// long-running (45s / 60s) timing-sensitive tests that are too slow and flaky
// for every commit, so they run only via `npm run test:e2e:nightly` and are
// excluded from the default `test:e2e` run (see playwright.config.ts testIgnore).
// A failing nightly run does not block the story; the result is recorded in
// NOTES.md. Chromium only, to keep the machine load minimal.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /\.nightly\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 150000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    // VIDI_TEST_HOOKS:1 lets the specs create their own boards through
    // /__test/boards/:id/initialize. Since story 5 a socket to a board that does not
    // exist is refused, and these specs need a board to sit in front of their link;
    // the hook creates it without spending the creation rate limit (see
    // playwright.config.ts for the same arrangement).
    command: `npm run build:test && npx wrangler dev --port ${PORT} --var VIDI_TEST_HOOKS:1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
