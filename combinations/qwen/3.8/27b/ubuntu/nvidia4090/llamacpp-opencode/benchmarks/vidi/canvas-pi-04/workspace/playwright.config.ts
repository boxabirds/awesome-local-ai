import { defineConfig, devices } from '@playwright/test';

// E2E tests run against `wrangler dev`, which serves the prebuilt client
// from `dist/client` (see wrangler.jsonc). `npm run test:e2e` builds the
// client in `test` mode first so the `window.__vidi6` test hook is present.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
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
