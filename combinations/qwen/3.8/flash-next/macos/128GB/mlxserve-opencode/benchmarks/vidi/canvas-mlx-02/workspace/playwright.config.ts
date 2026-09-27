import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Firefox launches its own OS-level sandbox, which is blocked in some CI
    // sandboxes. It is part of the design's browser matrix, so it stays here,
    // enabled with E2E_FIREFOX=1 where the environment allows it. See NOTES.md.
    ...(process.env.E2E_FIREFOX
      ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
  webServer: {
    // Serve the client (built in test mode, so the __vidi6 hook is present)
    // through the same static-asset path used in production: `wrangler dev`.
    command: 'npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
