import { defineConfig, devices } from '@playwright/test';

/** E2E_PORT overrides the shared server's port (e.g. when 8787 is taken on a shared machine). */
const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WEB_SERVER_TIMEOUT_MS = 120_000;
const VIEWPORT = { width: 1280, height: 800 } as const;
/**
 * All e2e tests share one local workerd process. Since story 4 the board room uses hibernatable
 * WebSockets and writes every update before broadcasting; locally each message then costs far
 * more (5-person soak: p50 9 ms → 272 ms), and with Playwright's default of one worker per two
 * cores the multi-person tests' 1 s live-update budget was missed from CPU contention alone.
 * Assertions are unchanged; only how many tests load the single local server at once.
 */
const E2E_WORKERS = 2;
const ALL_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
/** Long-running checks (idle stability, capacity soak) run only via `npm run test:e2e:nightly`. */
const NIGHTLY = /\.nightly\.spec\.ts$/;
/** Specs that start and kill their own `wrangler dev` processes (story 4); Chromium only. */
const PERSISTENCE = /persistence\.spec\.ts$/;
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
  workers: E2E_WORKERS,
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
      testIgnore: [NIGHTLY, PERSISTENCE],
      use: { ...deviceFor[name], viewport: VIEWPORT, deviceScaleFactor: 1 },
    })),
    {
      // Own wrangler dev processes per test (tests/e2e/helpers/wrangler-process.ts); the shared
      // webServer below still runs, because it builds the test-mode client these processes serve.
      name: 'persistence',
      testMatch: PERSISTENCE,
      use: { ...deviceFor.chromium, viewport: VIEWPORT, deviceScaleFactor: 1 },
    },
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
    // dist/client exactly as production will. TEST_HOOKS=1 enables the /__test/* storage
    // routes (story 4); production config never sets it.
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} --var TEST_HOOKS:1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: WEB_SERVER_TIMEOUT_MS,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
