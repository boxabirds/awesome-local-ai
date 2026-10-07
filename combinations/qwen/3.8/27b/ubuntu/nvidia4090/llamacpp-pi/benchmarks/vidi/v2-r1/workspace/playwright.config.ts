import { defineConfig } from '@playwright/test';

const PORT = 28432;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      testIgnore: ['nightly.spec.ts'],
    },
    {
      name: 'nightly',
      use: { browserName: 'chromium' },
      testMatch: ['nightly.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run dev:test',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
