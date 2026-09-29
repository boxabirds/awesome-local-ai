import { defineConfig, devices } from '@playwright/test';

const PORT = 5178;
const HOST = '127.0.0.1';
const baseURL = `http://${HOST}:${PORT}`;

// E2E runs against the same serving path used in production: `wrangler dev`
// serving the static client build (design: "Static assets served by
// `wrangler dev` in e2e so the same serving path is used from day one").
// The client is built with `--mode test` so the `window.__vidi6` test hook is
// present; production builds exclude it.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Firefox's macOS content-process sandbox cannot start inside a
        // sandboxed CI/agent environment (sandbox_init returns EPERM and the
        // browser hangs before any page loads). It is not needed to exercise
        // the app, and `about:config`-level behaviour is out of scope here.
        launchOptions: {
          env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `npm run build:test && npx --yes wrangler dev --port ${PORT} --ip ${HOST}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
