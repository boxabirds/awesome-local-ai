import { defineConfig, devices } from '@playwright/test';

// The e2e build uses --mode test so the window.__vidi6 test hook exists.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:8791', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'npm run build:test && npx wrangler dev --port 8791 --var TEST_HOOKS:1',
    url: 'http://localhost:8791',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium-nightly', testMatch: /nightly\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'chromium', testIgnore: /nightly\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'firefox', testIgnore: /nightly\.spec/, use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', testIgnore: /nightly\.spec/, use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
});
