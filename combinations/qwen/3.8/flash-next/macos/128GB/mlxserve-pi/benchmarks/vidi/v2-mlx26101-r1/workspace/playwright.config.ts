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
  // The restart-persistence specs own their own `wrangler dev` processes and must
  // run serially on their own ports; they belong to playwright.persistence.config.ts
  // only. Excluding them here keeps `test:e2e` (parallel, shared server) from also
  // spawning them.
  testIgnore: /persistence\.spec\.ts$/,
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
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium slows down timers in pages it thinks are hidden or covered by
        // another window, which would hold up the connection badge's own timers
        // (and anything on requestAnimationFrame) for up to a minute. Tests need a
        // page's timers to run at their real length even when several boards are
        // open side by side.
        launchOptions: {
          args: [
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ],
        },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ].filter((project) => enabledBrowsers.includes(project.name)),
  // `npm run test:e2e` builds the client in test mode (which enables the
  // window.__vidi6 test hook) and then serves it with wrangler, exercising the
  // same static-asset serving path the Worker will use from story 3.
  webServer: {
    // `--persist-to` gives this server its own local state directory. Two
    // `wrangler dev` processes sharing the default `.wrangler/state` make workerd
    // die with `SQLITE_BUSY` on the second one's reload, which looks like a
    // mysterious "runtime failed to start" and has nothing to do with the code.
    command: `npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --persist-to node_modules/.tmp/wrangler-state-${PORT} --local`,
    url: baseURL,
    // Reuse a `wrangler dev` that is already listening (this sandbox cannot kill
    // processes, so each run would otherwise need two fresh ports). A server that
    // is already running snapshots its asset list when it starts, which is why
    // `npm run test:e2e` touches a Worker source file after building: that makes a
    // lingering server reload and read the new assets, so it never serves a stale
    // bundle. In a clean environment Playwright starts the server after the build
    // and there is nothing stale to serve.
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
  },
});
