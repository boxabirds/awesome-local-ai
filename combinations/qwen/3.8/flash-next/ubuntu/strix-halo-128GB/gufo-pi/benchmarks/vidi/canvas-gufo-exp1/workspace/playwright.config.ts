import { defineConfig, devices } from '@playwright/test';

// E2E runs against the same serving path used in production: `wrangler dev`
// serving the static client build from `dist/client` (wrangler.jsonc).
// The build is made with `--mode test` so the `window.__vidi6` test hook exists;
// production builds exclude it.
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
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} --no-x-devtok`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
