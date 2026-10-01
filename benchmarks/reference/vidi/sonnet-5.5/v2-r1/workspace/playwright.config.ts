import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:8787', viewport },
  webServer: {
    command: 'npx wrangler dev --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
  ],
});
