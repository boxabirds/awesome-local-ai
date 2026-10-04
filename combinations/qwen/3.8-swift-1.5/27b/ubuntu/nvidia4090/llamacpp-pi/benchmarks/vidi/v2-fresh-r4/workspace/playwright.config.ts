import { defineConfig } from '@playwright/test';

// All servers started by this repository must listen on ports from
// $AGENT_PORT_FIRST to $AGENT_PORT_LAST. These constants sit inside that
// range; adjust together if the allocation moves.
const SERVER_PORT = 27240;
const INSPECTOR_PORT = 27241;

export default defineConfig({
  testDir: 'tests/e2e',
  // Persistence E2E runs its own `wrangler dev --persist-to` process per suite
  // (see playwright.persistence.config.ts), so it is excluded here.
  testIgnore: 'persistence/**',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${SERVER_PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    // Serve the exact same static assets path used in production
    // (wrangler serves dist/client). The build uses --mode test so the
    // window.__vidi6 test hook is available.
    command: `npm run build:e2e && wrangler dev --port ${SERVER_PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: `http://localhost:${SERVER_PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
