import { defineConfig } from '@playwright/test';

// E2E runs against the real serving path: `wrangler dev` serving the built
// client (dist/client) in test mode so the window.__vidi6 test hook is present.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run build:e2e && wrangler dev --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
