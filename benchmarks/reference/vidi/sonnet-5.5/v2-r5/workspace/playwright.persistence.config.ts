import { defineConfig, devices } from '@playwright/test';

// Persistence e2e controls its own `wrangler dev --persist-to` process (kill and restart), so this
// project set has no shared webServer.
export const PERSIST_PORT = 8792;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /persistence\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 180_000,
  use: { baseURL: `http://localhost:${PERSIST_PORT}`, viewport: { width: 1280, height: 800 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
