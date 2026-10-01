import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 1280, height: 800 };

/** Persistence specs start and kill their own `wrangler dev` processes, so there is no shared webServer. */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/persistence.spec.ts',
  workers: 1,
  timeout: 180_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } }],
});
