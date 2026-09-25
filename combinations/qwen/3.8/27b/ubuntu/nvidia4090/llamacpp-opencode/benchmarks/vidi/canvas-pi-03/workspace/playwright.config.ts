import { defineConfig, devices } from '@playwright/test';

/**
 * Story 3 e2e runs against the REAL worker + Durable Object + WebSocket path:
 * the web server is `wrangler dev` (which serves the built client AND the
 * `/api/rooms` WebSocket upgrade). `vite preview` cannot proxy the worker, so
 * it is not used here.
 *
 * The nightly project (idle stability + capacity soak) is excluded from the
 * default `test:e2e` (which targets `--project chromium` only).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/nightly/**',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-nightly',
      testMatch: '**/nightly/**',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run build:e2e && npx wrangler dev --port 8787 --local',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
