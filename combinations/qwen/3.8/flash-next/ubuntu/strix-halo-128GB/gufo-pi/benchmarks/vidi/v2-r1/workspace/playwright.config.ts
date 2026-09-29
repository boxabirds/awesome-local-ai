import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The e2e suite runs against `wrangler dev` serving the static client from
 * `dist/client`, so the same serving path used in production is exercised from
 * day one. The client is rebuilt in `--mode test` first, which is what enables
 * the `window.__vidi6` test hook (it is excluded from production builds).
 */
const serveCommand =
  `npm run build:test && ` +
  `npx --no-install wrangler dev --local --ip 127.0.0.1 --port ${PORT}`;

const browsersRoot =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), '.cache', 'ms-playwright');

function isInstalled(browser: 'chromium' | 'firefox' | 'webkit'): boolean {
  if (process.env.E2E_BROWSERS) {
    return process.env.E2E_BROWSERS.split(',').includes(browser);
  }
  if (!fs.existsSync(browsersRoot)) return false;
  return fs
    .readdirSync(browsersRoot)
    .some((entry) => entry.startsWith(browser === 'webkit' ? 'webkit' : `${browser}-`));
}

const allProjects: Array<{
  name: 'chromium' | 'firefox' | 'webkit';
  use: { browserName: 'chromium' | 'firefox' | 'webkit' };
}> = [
  { name: 'chromium', use: { browserName: 'chromium' } },
  { name: 'firefox', use: { browserName: 'firefox' } },
  { name: 'webkit', use: { browserName: 'webkit' } },
];

const projects = allProjects.filter((project) => isInstalled(project.name));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  projects: projects.length > 0 ? projects : allProjects.slice(0, 1),
  webServer: {
    command: serveCommand,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
