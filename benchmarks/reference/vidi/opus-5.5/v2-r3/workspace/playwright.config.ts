import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices, firefox, webkit, type BrowserType } from '@playwright/test';
import { E2E_PORT as PORT } from './tests/e2e/helpers/server';

const VIEWPORT = { width: 1280, height: 800 };

function installed(browser: BrowserType): boolean {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
}

// Chromium, Firefox and WebKit per the design; browsers that are not
// installed locally are skipped (see NOTES.md).
const browsers = [
  { name: 'chromium', browser: chromium, device: devices['Desktop Chrome'] },
  { name: 'firefox', browser: firefox, device: devices['Desktop Firefox'] },
  { name: 'webkit', browser: webkit, device: devices['Desktop Safari'] },
].filter((p) => installed(p.browser));

// Story 4 restart tests start and kill their own `wrangler dev` processes, so they
// live in a separate project (Chromium only) instead of using the shared server.
const PERSISTENCE_SPEC = /persistence\.spec\.ts$/;
const projects = [
  ...browsers.map((p) => ({
    name: p.name,
    testIgnore: PERSISTENCE_SPEC,
    use: { ...p.device, viewport: VIEWPORT },
  })),
  ...browsers
    .filter((p) => p.name === 'chromium')
    .map((p) => ({
      name: 'persistence',
      testMatch: PERSISTENCE_SPEC,
      fullyParallel: false,
      use: { ...p.device, viewport: VIEWPORT },
    })),
];

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects,
  webServer: {
    // Test-mode build exposes window.__vidi6; served by wrangler from dist/client.
    // TEST_HOOKS=1 enables the worker's /__test/* routes (story 4); production never sets it.
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} --var TEST_HOOKS:1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
