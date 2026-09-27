// Nightly Playwright config for story 3's cross-browser collaboration specs,
// which open multiple contexts, simulate network outages, and assert convergence
// — so they need generous timeouts and a couple of retries. The regular
// playwright.config.ts stays fast and does not run these.
//
// Browsers are not installed in every sandbox; if `npx playwright install` has
// not been run these specs will fail to launch (documented in NOTES.md).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*(collaboration|connection)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 2,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ...(process.env.E2E_FIREFOX
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
  webServer: {
    command: 'npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
