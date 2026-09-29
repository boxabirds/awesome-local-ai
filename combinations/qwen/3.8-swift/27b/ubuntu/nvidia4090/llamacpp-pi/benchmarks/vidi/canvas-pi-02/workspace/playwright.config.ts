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
    // Default e2e: every browser, excluding the slow nightly specs. The
    // persistence spec is excluded: it manages its own wrangler process
    // (kill/restart) and runs via playwright.persistence.config.ts.
    { name: 'chromium', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]|persistence\.spec\.ts$/, use: { browserName: 'chromium' } },
    { name: 'firefox', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]|persistence\.spec\.ts$/, use: { browserName: 'firefox' } },
    { name: 'webkit', testMatch: /.*\.spec\.ts$/, testIgnore: /nightly[\\/]|persistence\.spec\.ts$/, use: { browserName: 'webkit' } },
    // Nightly: timing-sensitive long-running sync.client verification
    // (chromium only). Excluded from `test:e2e`; run via `test:e2e:nightly`.
    { name: 'nightly', testMatch: /nightly[\\/].*\.nightly\.spec\.ts$/, use: { browserName: 'chromium' } },
  ],
  webServer: {
    // --env-file sets TEST_HOOKS=1 (worker binding; wrangler dev does not
    // inherit shell env): exposes /_test/:id/initialize so specs can create
    // boards with pinned ids without tripping the creation rate limit
    // (story 5); production config never sets it (TC-24).
    command: 'npm run build:e2e && wrangler dev --port 8787 --ip 127.0.0.1 --env-file tests/e2e/e2e.env',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
