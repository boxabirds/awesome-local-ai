import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_PORT } from './tests/e2e/helpers/server';

/** Port for the e2e `wrangler dev` server; override with E2E_PORT when it is taken. */
const port = E2E_PORT;
const baseURL = E2E_BASE_URL;
const SERVER_START_TIMEOUT_MS = 120_000;

/**
 * Browsers to run, comma separated (chromium, firefox, webkit). Defaults to all three
 * that the design names; set E2E_BROWSERS=chromium where WebKit/Firefox cannot launch.
 */
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox,webkit')
  .split(',')
  .map((b) => b.trim())
  .filter((b) => b.length > 0);

const deviceFor: Record<string, (typeof devices)[string]> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

/**
 * Long-running specs (`*.nightly.spec.ts`: idle stability, capacity soak) run only via
 * `npm run test:e2e:nightly`, which sets E2E_NIGHTLY=1; the default run excludes them.
 */
const nightly = process.env.E2E_NIGHTLY === '1';
const NIGHTLY_SPECS = '**/*.nightly.spec.ts';
/**
 * Story 4 restart specs start and kill their own `wrangler dev --persist-to` processes
 * (tests/e2e/helpers/wrangler-process.ts); they run in their own chromium project.
 */
const PERSISTENCE_SPECS = '**/persistence.spec.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  ...(nightly ? { testMatch: NIGHTLY_SPECS } : { testIgnore: NIGHTLY_SPECS }),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    ...browsers.map((name) => ({
      name,
      testIgnore: nightly ? undefined : [NIGHTLY_SPECS, PERSISTENCE_SPECS],
      use: { ...deviceFor[name], viewport: { width: 1280, height: 800 } },
    })),
    ...(nightly
      ? []
      : [
          {
            name: 'persistence',
            testMatch: PERSISTENCE_SPECS,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
        ]),
  ],
  webServer: {
    // Test-mode build so the window.__vidi6 test hook exists; served by wrangler like production.
    // TEST_HOOKS enables the story 4 storage corruption/repair routes; never set in wrangler.jsonc.
    command: `npm run build:test && npx wrangler dev --port ${port} --ip 127.0.0.1 --var TEST_HOOKS:1 --show-interactive-dev-session=false`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: SERVER_START_TIMEOUT_MS,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
