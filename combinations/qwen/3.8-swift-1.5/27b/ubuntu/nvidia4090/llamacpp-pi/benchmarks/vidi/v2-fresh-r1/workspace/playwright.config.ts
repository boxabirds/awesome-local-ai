import { defineConfig } from '@playwright/test';

// E2E runs against the same serving path used in production: the Vite build
// (in test mode, so the `window.__vidi6` hook is present) served by
// `wrangler dev`. Port 24368 is within the agent's assigned port range.
const PORT = 24368;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Long tests (outage catch-up, capacity soak) set their own timeouts via
  // test.setTimeout(); the default stays at 30s for the fast e2e suite.
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /nightly/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      testIgnore: /nightly/,
      use: { browserName: 'firefox' },
    },
    // Nightly: long-running soak + idle keep-alive checks (tests/e2e/nightly).
    {
      name: 'chromium-nightly',
      testMatch: /nightly\/.*\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox-nightly',
      testMatch: /nightly\/.*\.spec\.ts/,
      use: { browserName: 'firefox' },
    },
    // WebKit is not available on this host (missing system library libavif13,
    // no root access to install it); see NOTES.md.
  ],
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
