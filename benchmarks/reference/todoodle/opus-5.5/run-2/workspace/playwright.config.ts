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
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/*.touch.spec.ts' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: '**/*.touch.spec.ts' },
    // Real touch layout (no hover, coarse pointer): story 3's TC-91.
    { name: 'mobile-touch', use: { ...devices['iPhone 13'], hasTouch: true }, testMatch: '**/*.touch.spec.ts' },
  ],
  webServer: {
    command: 'bun run dev',
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
