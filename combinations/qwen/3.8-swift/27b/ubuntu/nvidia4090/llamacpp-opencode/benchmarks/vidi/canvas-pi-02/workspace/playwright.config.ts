import { defineConfig } from '@playwright/test';

// E2E runs against the real serving path: `wrangler dev` serving the built
// client (dist/client) in test mode so the window.__vidi6 test hook is present.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  // The live-collaboration tests are real-time and run against a single local
  // wrangler server + Durable Object. Running the three browser projects
  // concurrently (the Playwright default) contends for CPU and makes sync
  // latencies exceed the live-update budget, so run the projects
  // sequentially for stable results.
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    // Default e2e: every browser, excluding the slow nightly specs.
    { name: 'chromium', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]/, use: { browserName: 'chromium' } },
    { name: 'firefox', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]/, use: { browserName: 'firefox' } },
    { name: 'webkit', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]/, use: { browserName: 'webkit' } },
    // Nightly: timing-sensitive long-running sync.client verification
    // (chromium only). Excluded from `test:e2e`; run via `test:e2e:nightly`.
    { name: 'nightly', testMatch: /nightly[\\/].*\.nightly\.spec\.ts$/, use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build:e2e && wrangler dev --port 8787 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
