import { defineConfig, devices } from '@playwright/test';

/** Port for the e2e `wrangler dev` server; override with E2E_PORT when it is taken. */
const DEFAULT_E2E_PORT = 8795;
const port = Number(process.env.E2E_PORT ?? DEFAULT_E2E_PORT);
const baseURL = `http://127.0.0.1:${port}`;
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

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: browsers.map((name) => ({
    name,
    use: { ...deviceFor[name], viewport: { width: 1280, height: 800 } },
  })),
  webServer: {
    // Test-mode build so the window.__vidi6 test hook exists; served by wrangler like production.
    command: `npm run build:test && npx wrangler dev --port ${port} --ip 127.0.0.1 --show-interactive-dev-session=false`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: SERVER_START_TIMEOUT_MS,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
