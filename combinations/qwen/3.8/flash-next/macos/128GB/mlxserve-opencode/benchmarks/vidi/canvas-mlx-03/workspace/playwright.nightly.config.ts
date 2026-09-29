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
    command: `npm run build:test && npx wrangler dev --port ${PORT}`,
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
