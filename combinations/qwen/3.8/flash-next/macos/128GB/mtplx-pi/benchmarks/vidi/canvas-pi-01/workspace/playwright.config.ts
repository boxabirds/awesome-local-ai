import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against `wrangler dev` serving the built client (dist/client),
 * so the production serving path is exercised from day one (see design
 * "Mock vs real boundaries"). The test build (`vite build --mode test`) is
 * produced by the `test:e2e` npm script before Playwright starts.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Three browser projects run at once and each persistence case spawns its own
  // `wrangler dev`. Nine workers on a twelve-core machine starved the 2,000-note
  // render of CPU (it passed alone in 200 ms, timed out at 60 s under load), so
  // the pool is capped at what the machine can actually serve at once.
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Firefox brings its own macOS process sandbox, which cannot be
        // entered when the whole run is already inside a restricted sandbox
        // (it aborts instead of starting). Test-only: the board's behaviour
        // does not depend on it, and it is off only for these runs.
        launchOptions: {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: '1',
            MOZ_DISABLE_GPU_SANDBOX: '1',
          },
        },
        // The device preset's own viewport is replaced by the story's
        // 1280x800, so every project measures the same board area.
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      // `--env e2e` turns on the /__test/* storage routes (wrangler.jsonc
      // `env.e2e.vars.TEST_HOOKS`); it is the only place they exist.
      command: 'npx wrangler dev --env e2e --port 8787',
      url: 'http://localhost:8787',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // The same app with the default environment, where `TEST_HOOKS` is not
      // set: used only to prove the storage routes are not reachable there.
      command: 'npx wrangler dev --port 8788',
      url: 'http://localhost:8788',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      // Story 5 TC-30: the *production* create limit (10 boards a minute per
      // visitor). The shared 8787 server raises its own limit, because three
      // browser projects share one limiter key locally, so the abuse guard
      // needs a server of its own or it would only ever measure the allowance.
      command: 'npx wrangler dev --env e2e_limited --port 8789',
      url: 'http://localhost:8789',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
    },
  ],
});
