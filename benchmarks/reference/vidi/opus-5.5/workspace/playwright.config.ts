import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WEB_SERVER_TIMEOUT_MS = 120_000;
const VIEWPORT = { width: 1280, height: 800 } as const;
const ALL_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
/** Long-running checks (idle stability, capacity soak) run only via `npm run test:e2e:nightly`. */
const NIGHTLY = /\.nightly\.spec\.ts$/;
const nightlyEnabled = process.env.E2E_NIGHTLY === '1';

/**
 * E2E_BROWSERS (comma-separated) limits the browser projects, e.g. on machines
 * where WebKit's system libraries are not installed. Default: all three.
 */
const selected = (process.env.E2E_BROWSERS ?? ALL_BROWSERS.join(','))
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

const deviceFor = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    ...ALL_BROWSERS.filter((b) => selected.includes(b)).map((name) => ({
      name,
      testIgnore: NIGHTLY,
      use: { ...deviceFor[name], viewport: VIEWPORT, deviceScaleFactor: 1 },
    })),
    ...(nightlyEnabled
      ? [
          {
            name: 'nightly',
            testMatch: NIGHTLY,
            use: { ...deviceFor.chromium, viewport: VIEWPORT, deviceScaleFactor: 1 },
          },
        ]
      : []),
  ],
  webServer: {
    // The test-mode build includes the window.__vidi6 test hook; wrangler dev serves
    // dist/client exactly as production will.
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: WEB_SERVER_TIMEOUT_MS,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
