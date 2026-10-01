import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

// Browsers other than Chromium are included per the design; set VIDI_E2E_CHROMIUM_ONLY=1
// where Firefox/WebKit are not installed.
const nightly = process.env.VIDI_E2E_NIGHTLY === '1';
const chromiumOnly = process.env.VIDI_E2E_CHROMIUM_ONLY === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  // Slow soak tests live in tests/e2e/nightly and only run via npm run test:e2e:nightly.
  ...(nightly ? { testMatch: '**/nightly/*.spec.ts' } : { testIgnore: '**/nightly/**' }),
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    // Test-mode build so window.__vidi6 exists; served through wrangler's static assets.
    command: `npm run build:test && npx wrangler dev --port ${PORT} --var TEST_HOOKS:1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    ...(chromiumOnly
      ? []
      : [
          { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } } },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
        ]),
  ],
});
