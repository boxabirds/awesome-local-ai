import { defineConfig, devices } from '@playwright/test';

import { BASE_URL, PORT } from './tests/e2e/target.js';

// The address comes from tests/e2e/target.ts, because the tests ask the server for a board
// from Node before any page is opened, and that request has to go to the same server this
// config starts (all servers listen inside $AGENT_PORT_FIRST..$AGENT_PORT_LAST, see NOTES.md).
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? PORT + 1);
const VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    {
      // A second chromium configuration, on a 2x surface: the dot grid,
      // sub-pixel grid phases and the counter-scaled origin marker are all
      // exercised again on a retina-style rendering.
      name: 'chromium-retina',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, deviceScaleFactor: 2 },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ],
  webServer: {
    // e2e runs against the same serving path as production: `wrangler dev`
    // statically serving dist/client. The test build exposes window.__vidi6.
    //
    // `--var TEST_HOOKS:1` turns the room's test routes on (`src/worker/test-hooks.ts`:
    // damage a board's snapshot, put it back, fold its log, fill it with notes). It is a
    // command-line variable of *this* server and is deliberately absent from
    // `wrangler.jsonc`, so the production configuration has no such routes - and one of
    // the e2e tests asks a server started without it for them and expects a 404.
    command: `npm run build:test && exec wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --var TEST_HOOKS:1`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
