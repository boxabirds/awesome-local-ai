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
  // Story 4's persistence tests start and stop their own `wrangler dev` processes -
  // that is the thing under test - and they are given their own projects, listed last,
  // so that a machine runs its dev servers and its browsers a little further apart.
  // Enough workerd runtimes and browsers at once is enough load to make a test that
  // measures convergence in milliseconds miss its budget, and a test that fails only
  // when other tests happen to be running on the same machine says nothing about the
  // product. Nothing in the tests depends on this ordering; it is scheduling, not
  // correctness, and a run with `--project persistence-chromium` works on its own.
  projects: (() => {
    const uses = {
      chromium: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
      firefox: { ...devices['Desktop Firefox'], viewport: VIEWPORT, launchOptions: firefoxLaunch },
      webkit: { ...devices['Desktop Safari'], viewport: VIEWPORT },
    };
    const browsers = Object.keys(uses) as (keyof typeof uses)[];
    const persistence = /persistence\.spec\.ts$/;
    return [
      ...browsers.map((name) => ({ name, testIgnore: persistence, use: uses[name] })),
      ...browsers.map((name) => ({
        name: `persistence-${name}`,
        testMatch: persistence,
        use: uses[name],
      })),
    ];
  })(),
  webServer: {
    command: `npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
