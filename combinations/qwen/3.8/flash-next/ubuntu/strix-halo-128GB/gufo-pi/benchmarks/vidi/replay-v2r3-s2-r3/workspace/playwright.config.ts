import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
  },
  // Chromium only: this environment has no system libraries for Firefox/WebKit
  // (browserType.launch fails with "Host system is missing dependencies"), which is
  // why story 1 shipped this way. Once `npx playwright install-deps` has run, add:
  //   { name: 'firefox', use: { browserName: 'firefox' } },
  //   { name: 'webkit', use: { browserName: 'webkit' } },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'vite build --mode test && npx wrangler dev --port 5173',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
