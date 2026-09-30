import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 8787);
const baseURL = `http://127.0.0.1:${PORT}`;

// Only run browser projects whose engines are actually installed, so the suite
// passes on machines that ship just Chromium. Chromium is always attempted.
const browsersRoot =
  process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
function installed(prefix: string): boolean {
  try {
    return existsSync(browsersRoot) && readdirSync(browsersRoot).some((d) => d.startsWith(`${prefix}-`));
  } catch {
    return false;
  }
}

const viewport = { width: 1280, height: 800 };

const projects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
  ...(installed('firefox')
    ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } }]
    : []),
  ...(installed('webkit')
    ? [{ name: 'webkit', use: { ...devices['Desktop Safari'], viewport } }]
    : []),
];

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: process.env.NIGHTLY ? [] : ['**/*nightly*'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    // Serve the client through the real path used from day one: build the
    // test-mode bundle (enables window.__vidi6) and serve it with wrangler dev.
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { CI: '1' },
    stdout: 'pipe',
  },
});
