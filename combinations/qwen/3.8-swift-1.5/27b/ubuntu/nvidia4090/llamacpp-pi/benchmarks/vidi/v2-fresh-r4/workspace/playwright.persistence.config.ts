import { defineConfig } from '@playwright/test';

// Persistence E2E uses its own port allocation so it can run a real
// `wrangler dev --persist-to` process per suite (no shared webServer).
const SERVER_PORT = 27242;
const INSPECTOR_PORT = 27243;

export default defineConfig({
  testDir: 'tests/e2e/persistence',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${SERVER_PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  globalSetup: './tests/e2e/persistence/global-setup.ts',
});
