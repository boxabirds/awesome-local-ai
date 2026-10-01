import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/** Default laptop viewport, per the design's fixtures. */
const VIEWPORT = { width: 1280, height: 800 };

/**
 * The design asks for Chromium, Firefox and WebKit. Firefox and WebKit need
 * extra system libraries (libgtk-3, libwoff, ...); when they are not installed
 * the browser cannot launch, so the default project list is Chromium only and
 * `npm run test:e2e:all` runs all three on a fully provisioned host.
 */
const ALL_PROJECTS = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
  { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
];

const selected = (process.env.E2E_PROJECTS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * E2E runs against `wrangler dev` serving the built client from dist/client, so
 * the same serving path used in production is exercised from day one. The build
 * is made in `test` mode so the `window.__vidi6` camera hook exists.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    viewport: VIEWPORT,
  },
  projects: ALL_PROJECTS.filter((project) => selected.includes(project.name)),
  webServer: {
    command: 'npm run e2e:server',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
