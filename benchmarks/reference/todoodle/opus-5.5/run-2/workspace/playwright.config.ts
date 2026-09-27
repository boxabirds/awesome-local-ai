import { defineConfig, devices } from '@playwright/test';

// Hard-coded local origin: e2e tests must never point at staging or production.
const BASE_URL = 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  retries: 0,
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'bun run dev',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
