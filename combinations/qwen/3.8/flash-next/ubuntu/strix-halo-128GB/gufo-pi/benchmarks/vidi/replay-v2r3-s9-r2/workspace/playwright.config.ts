import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
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
      use: { browserName: 'chromium', baseURL: 'http://localhost:5411' },
      testMatch: /persistence\.spec\.|broken-board\.spec\./,
    },
    // Text wrapping is a browser job, so the annotation workflow (TC-26) is also
    // meant to run in firefox and webkit. Their binaries are installed on this
    // machine but cannot start (missing system libraries, see NOTES.md), so the
    // two projects below are kept commented out until one provides them:
    //
    // { name: 'firefox', use: { browserName: 'firefox' }, testMatch: /text\.spec\./ },
    // { name: 'webkit', use: { browserName: 'webkit' }, testMatch: /text\.spec\./ },
    //
    // text.spec.ts uses no chromium-only API, so those two lines are all that is
    // needed to switch the cross-browser leg on.
  ],
  // The shared wrangler dev (built test-mode client) backs the interactive specs.
  // The build here also ensures `dist` exists for the persistence specs' own
  // wrangler instances, which read static assets from the same directory.
  webServer: {
    command: 'vite build --mode test && npx wrangler dev --port 5173 --var TEST_HOOKS:1',
    port: 5173,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
