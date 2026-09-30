import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices, firefox, webkit, type BrowserType } from '@playwright/test';

const PORT = 8787;
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
const projects = [
  { name: 'chromium', browser: chromium, device: devices['Desktop Chrome'] },
  { name: 'firefox', browser: firefox, device: devices['Desktop Firefox'] },
  { name: 'webkit', browser: webkit, device: devices['Desktop Safari'] },
]
  .filter((p) => installed(p.browser))
  .map((p) => ({ name: p.name, use: { ...p.device, viewport: VIEWPORT } }));

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
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});
