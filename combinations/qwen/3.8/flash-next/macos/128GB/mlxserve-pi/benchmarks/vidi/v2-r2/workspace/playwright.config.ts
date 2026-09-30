import { defineConfig, devices } from '@playwright/test';

// e2e runs against `wrangler dev` serving the static client build (the same
// serving path used in production). The client is built with MODE=test so the
// `window.__vidi6` test hooks are present.
const PORT = 4173;
const VIEWPORT = { width: 1280, height: 800 };

// On macOS the browsers need two allowances to start inside a sandboxed CI
// agent; neither changes what the tests exercise, and Linux CI is untouched.
const macOSAgent = process.platform === 'darwin';
if (macOSAgent) {
  // Playwright's WebKit host-requirements check cannot run unprivileged.
  process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = '1';
}
const firefoxLaunch = macOSAgent
  ? {
      // Firefox's own macOS process sandbox cannot initialise without the
      // privilege, so its content process runs unsandboxed here.
      env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1', MOZ_DISABLE_RDD_SANDBOX: '1' },
    }
  : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: VIEWPORT,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT, launchOptions: firefoxLaunch } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
