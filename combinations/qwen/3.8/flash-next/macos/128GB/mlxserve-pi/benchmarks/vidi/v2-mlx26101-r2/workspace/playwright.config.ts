import { defineConfig, devices } from '@playwright/test';

// All servers must listen inside $AGENT_PORT_FIRST..$AGENT_PORT_LAST (see NOTES.md).
// +4 because 24210/24211 were left occupied by a wrangler dev that this sandbox
// cannot signal (see NOTES.md); 24212/24213 are free.
const PORT = Number(process.env.E2E_PORT ?? (Number(process.env.AGENT_PORT_FIRST ?? 24208) + 4));
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;
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
    command: `npm run build:test && exec wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
