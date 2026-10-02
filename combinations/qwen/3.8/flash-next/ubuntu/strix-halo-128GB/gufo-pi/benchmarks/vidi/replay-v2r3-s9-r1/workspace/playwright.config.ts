import { defineConfig } from '@playwright/test';

// Ports come from the environment so a run can be moved off the defaults when
// they are already taken (E2E_PORT / E2E_PERSIST_PORT / E2E_BROKEN_PORT).
const PORT = Number(process.env.E2E_PORT ?? 5173);
const PERSIST_PORT = Number(process.env.E2E_PERSIST_PORT ?? 5411);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      testIgnore: /persistence\.spec\.|broken-board\.spec\./,
    },
    {
      name: 'persistence',
      // These specs manage their own `wrangler dev --persist-to` instances on
      // their own ports, so they do not use the shared webServer below.
      use: { browserName: 'chromium', baseURL: `http://localhost:${PERSIST_PORT}` },
      testMatch: /persistence\.spec\.|broken-board\.spec\./,
    },
  ],
  // The shared wrangler dev (built test-mode client) backs the interactive specs.
  // The build here also ensures `dist` exists for the persistence specs' own
  // wrangler instances, which read static assets from the same directory.
  webServer: {
    command: `vite build --mode test && npx wrangler dev --port ${PORT} --var TEST_HOOKS:1`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
