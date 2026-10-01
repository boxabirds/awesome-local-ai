import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'rm -rf /tmp/vidi6-e2e-persist && npx vite build --mode test && npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to "file:///tmp/vidi6-e2e-persist" --var TEST_HOOKS=1',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
