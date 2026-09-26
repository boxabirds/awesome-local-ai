import { defineConfig, devices } from '@playwright/test';

// E2E tests run against `wrangler dev`, which serves the prebuilt client
// from `dist/client` (see wrangler.jsonc). `npm run test:e2e` builds the
// client in `test` mode first so the `window.__vidi6` test hook is present.
export default defineConfig({
  testDir: './tests/e2e',
  // The nightly soak tests are slow (30-60s waits); they run under
  // `npm run test:e2e:nightly` (see playwright.nightly.config.ts).
  // The persistence spec manages its own wrangler process (kill/restart with
  // --persist-to) and runs under `npm run test:e2e:persistence` (see
  // playwright.persistence.config.ts).
  testIgnore: ['**/nightly/**', '**/persistence.spec.ts'],
  fullyParallel: true,
  // One wrangler dev serves every test; with 32 CPUs the default worker
  // count would hit it with ~16 parallel browser sessions and push the
  // live-update assertions past their latency budgets.
  workers: 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    // Fail fast on a stuck interaction (e.g. a locator click that cannot be
    // scrolled into view) instead of letting it ride out the test timeout.
    actionTimeout: 15_000,
  },
  // The device descriptors ship a 1280x720 viewport; the tests assume the
  // 1280x800 viewport from the PRD, so override it per project.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
