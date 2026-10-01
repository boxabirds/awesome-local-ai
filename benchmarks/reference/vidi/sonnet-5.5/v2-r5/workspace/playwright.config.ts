import { defineConfig, devices } from '@playwright/test';

const PORT = 8791;

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: /persistence\.spec\.ts/, // runs under playwright.persistence.config.ts (own wrangler process)
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `npx wrangler dev --port ${PORT} --var TEST_HOOKS:1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
});
