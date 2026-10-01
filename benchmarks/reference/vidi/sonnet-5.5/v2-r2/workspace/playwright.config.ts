import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;
const PERSISTENCE = /persistence\.spec\.ts$/;

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `npx wrangler dev --port ${PORT} --var TEST_HOOKS:1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', testIgnore: PERSISTENCE, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', testIgnore: PERSISTENCE, use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', testIgnore: PERSISTENCE, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
    // Starts and kills its own wrangler process (own port and --persist-to dir); the shared server is unused.
    { name: 'persistence', testMatch: PERSISTENCE, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
