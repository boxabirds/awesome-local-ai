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
  webServer: {
    command: 'npx wrangler dev --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
  },
});
