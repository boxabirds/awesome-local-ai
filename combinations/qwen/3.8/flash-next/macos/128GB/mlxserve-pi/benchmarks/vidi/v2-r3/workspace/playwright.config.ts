import { defineConfig, devices } from '@playwright/test';

// E2E runs against `wrangler dev` serving the static client build (the same
// serving path production will use). The build is made with
// `vite build --mode test` so the window.__vidi6 test hook is included.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: 'npm run build:test && npx wrangler dev --port 4173 --ip 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      // Note: firefox cannot launch in some sandboxed macOS CI boxes; the
      // test:e2e script runs chromium + webkit. Use `npx playwright test
      // --project=firefox` where firefox is runnable.
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
