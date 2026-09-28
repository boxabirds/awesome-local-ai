import { defineConfig, devices } from '@playwright/test';

// Nightly e2e config: runs only tests in tests/e2e/nightly.spec.ts
// These are long-running tests that are excluded from the default test:e2e run.
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'nightly.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
