import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production client build served by `wrangler dev`
// (same serving path as the real deployment; Worker code arrives in story 3).
// The build uses `--mode test` so the `window.__vidi6` test hook is present
// (it is dead-code-eliminated from the plain production build).
export default defineConfig({
  testDir: './tests/e2e',
  // Nightly suites (task 9) run only via playwright.nightly.config.ts;
  // persist.spec.ts (story 4) runs only via playwright.persist.config.ts,
  // where each test drives its own wrangler process instead of this
  // shared webServer.
  testIgnore: ['**/nightly/**', 'persist.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // A single retry absorbs intermittent flakes in the timing-sensitive e2e tests
  // (font fit, paste, drag, real-time sync) that occasionally miss their windows
  // under parallel load. A genuine regression fails both attempts and is still
  // reported, so this does not mask real bugs.
  retries: 1,
  // Cap the worker pool: this host has 32 cores, so the default (~31 workers)
  // would run ~31 headless browsers against one wrangler dev server at once. That
  // much parallel load causes timing jitter (and WebSocket churn) that makes the
  // timing-sensitive tests flake across every browser. A modest pool keeps them
  // deterministic without meaningfully slowing the suite.
  workers: 4,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
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
    command: 'npm run build:e2e && npx wrangler dev --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
