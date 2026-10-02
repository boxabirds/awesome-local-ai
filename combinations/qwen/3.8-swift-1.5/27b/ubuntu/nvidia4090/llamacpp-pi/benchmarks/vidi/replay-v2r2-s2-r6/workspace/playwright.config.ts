import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
  },
  // Explicit 1280×800 viewport on every project: the spec's geometry
  // assertions assume it, and the `devices` descriptors carry their own
  // viewport (e.g. Desktop Chrome is 1280×720) which would override the
  // top-level `use.viewport`.
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { browserName: 'firefox', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'npx wrangler dev --port 8787 --ip 127.0.0.1',
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
