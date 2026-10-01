import { defineConfig, devices, firefox, webkit } from '@playwright/test';

import { existsSync } from 'node:fs';

const PORT = 8787;
const VIEWPORT = { width: 1280, height: 800 };

function installed(name: 'firefox' | 'webkit'): boolean {
  try {
    return existsSync((name === 'firefox' ? firefox : webkit).executablePath());
  } catch {
    return false;
  }
}

export default defineConfig({
  testDir: 'tests/e2e',
  // Slow soak/idle tests run only via test:e2e:nightly (NIGHTLY=1).
  testIgnore: process.env.NIGHTLY === '1' ? [] : ['**/nightly/**'],
  testMatch: process.env.NIGHTLY === '1' ? ['**/nightly/**/*.spec.ts'] : ['**/*.spec.ts'],
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    // Test-mode build exposes window.__vidi6; served through wrangler like production.
    command: `npm run build:test && npx wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  // Firefox and WebKit projects are skipped when their browsers are not installed (see NOTES.md).
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    ...(installed('firefox') ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } }] : []),
    ...(installed('webkit') ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } }] : []),
  ],
});
