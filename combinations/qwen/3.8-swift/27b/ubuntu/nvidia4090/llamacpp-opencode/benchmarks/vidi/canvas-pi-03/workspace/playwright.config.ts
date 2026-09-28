import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the real server path: `wrangler dev` serves the Worker and
 * the BoardRoom Durable Objects (WebSocket sync) plus the static assets from
 * `dist/client`. The client is built in `test` mode so the `window.__vidi6`
 * test hook is present.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['nightly.spec.ts'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: ['nightly.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: ['nightly.spec.ts'],
    },
    // Nightly: timing-sensitive long-running tests, excluded from the default
    // `test:e2e` run (run via `test:e2e:nightly`).
    {
      name: 'nightly',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['nightly.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run build:test && npx wrangler dev --port 8787',
    port: 8787,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
