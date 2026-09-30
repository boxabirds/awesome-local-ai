import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices, firefox, webkit } from '@playwright/test';

const PORT = 8787;
const VIEWPORT = { width: 1280, height: 800 };
const NIGHTLY_SPECS = /\.nightly\.spec\.ts$/;

// Chromium, Firefox and WebKit per the design; browsers that are not installed
// locally are skipped (Chromium is always required).
const browsers = [
  { name: 'chromium', device: devices['Desktop Chrome'], type: chromium, required: true },
  { name: 'firefox', device: devices['Desktop Firefox'], type: firefox, required: false },
  { name: 'webkit', device: devices['Desktop Safari'], type: webkit, required: false },
].filter((b) => b.required || existsSync(b.type.executablePath()));

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: VIEWPORT,
  },
  projects: [
    ...browsers.map((b) => ({
      name: b.name,
      use: { ...b.device, viewport: VIEWPORT },
      testIgnore: NIGHTLY_SPECS,
    })),
    // Long-running checks (TC-29, TC-30): only with `npm run test:e2e:nightly`.
    ...(process.env.VIDI6_NIGHTLY
      ? [{ name: 'nightly', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT }, testMatch: NIGHTLY_SPECS }]
      : []),
  ],
  webServer: {
    // Test-mode build exposes window.__vidi6; served by wrangler like production.
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    env: { WRANGLER_SEND_METRICS: 'false' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
