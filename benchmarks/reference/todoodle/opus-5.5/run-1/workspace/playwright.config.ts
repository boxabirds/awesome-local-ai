import { defineConfig, devices } from '@playwright/test';

// Hard-coded to the local dev server: e2e tests can never target staging or production.
const LOCAL_BASE_URL = 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: LOCAL_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    // Chromium can be granted real clipboard access; WebKit cannot, so it exercises the manual-copy fallback.
    {
      name: 'chromium',
      testIgnore: '**/*.mobile.spec.ts',
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    { name: 'webkit', testIgnore: '**/*.mobile.spec.ts', use: { ...devices['Desktop Safari'] } },
    // Touch layout (story 3 TC-91): no hover, 44px targets.
    { name: 'mobile-touch', testMatch: '**/*.mobile.spec.ts', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    // Apply migrations first so a fresh checkout has the local schema.
    command: 'bun run db:migrate:local && bun run dev',
    url: `${LOCAL_BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
