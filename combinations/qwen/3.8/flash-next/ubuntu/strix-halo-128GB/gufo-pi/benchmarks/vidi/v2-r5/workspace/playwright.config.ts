import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? '8787');
const baseURL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * The e2e suite runs against `wrangler dev` serving `dist/client`, the same serving path
 * later stories use. The client is built in `test` mode so the test-only camera hook
 * (`window.__vidi6`) exists; production builds exclude it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: VIEWPORT,
    trace: 'off',
  },
  webServer: {
    command: `npm run build:test && npx --no-install wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { CI: '1' },
  },
  projects: [
    ...installedBrowsers().map((name) => ({
      name,
      use: { ...devices[name], viewport: VIEWPORT },
      testIgnore: /nightly/,
    })),
    {
      name: 'nightly',
      use: { ...devices['chromium'], viewport: VIEWPORT },
      testMatch: /nightly/,
      timeout: 180_000,
    },
  ],
});

/**
 * Only run browsers that are actually installed on this machine (Chromium is sufficient
 * where Firefox/WebKit have not been downloaded).
 */
function installedBrowsers(): ('chromium' | 'firefox' | 'webkit')[] {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright');
  const candidates: ('chromium' | 'firefox' | 'webkit')[] = ['chromium', 'firefox', 'webkit'];
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    entries = [];
  }
  const installed = candidates.filter((name) => entries.some((entry) => entry.startsWith(`${name}-`)));
  return installed.length > 0 ? installed : ['chromium'];
}
