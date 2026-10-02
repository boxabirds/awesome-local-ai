import { defineConfig, devices } from '@playwright/test';

// All servers must bind to the ports allotted to this agent.
const PORT = 28394;
const INSPECTOR_PORT = 28395;
const baseURL = `http://127.0.0.1:${PORT}`;

// The full matrix is chromium + firefox + webkit. This sandbox can only launch
// Chromium (Firefox/WebKit abort on start), so the default run is Chromium and
// the others are opted in with E2E_BROWSERS=chromium,firefox,webkit on a machine
// that can launch them. See NOTES.md.
const enabledBrowsers = (process.env.E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((b) => b.trim())
  .filter(Boolean);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ].filter((project) => enabledBrowsers.includes(project.name)),
  // `npm run test:e2e` builds the client in test mode (which enables the
  // window.__vidi6 test hook) and then serves it with wrangler, exercising the
  // same static-asset serving path the Worker will use from story 3.
  webServer: {
    command: `npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --local`,
    url: baseURL,
    // Always start a fresh server: `wrangler dev` disables its assets watcher
    // past the platform file-watch limit, so a reused process could serve stale
    // asset hashes after a rebuild.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
  },
});
