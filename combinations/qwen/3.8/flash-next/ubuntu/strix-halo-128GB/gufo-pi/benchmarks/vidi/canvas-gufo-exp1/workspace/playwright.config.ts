import { defineConfig, devices } from '@playwright/test';

// E2E runs against the built client (`--mode test`, so the `window.__vidi6` test
// hook exists) served statically from `dist/client`.
//
// NOTE: the design's `wrangler dev --no-x-devtok` command no longer exists in the
// installed wrangler (4.x), and `wrangler dev` refuses to serve an assets-only
// Worker that still declares the `ASSETS` binding (story 3 adds the Worker code that
// needs it). `vite preview` serves the exact same `dist/client` output, so the
// browser under test is unchanged. See NOTES.md.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ],
  webServer: {
    command: `npm run build:test && npx vite preview --mode test --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
