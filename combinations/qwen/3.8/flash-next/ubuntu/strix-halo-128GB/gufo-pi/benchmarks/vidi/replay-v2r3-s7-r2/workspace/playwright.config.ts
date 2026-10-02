import { defineConfig } from '@playwright/test';

// TC-32 asks for the marquee in every engine, because containment is decided by
// each browser's own layout. Those runs are opt-in with PLAYWRIGHT_CROSS_BROWSER=1:
// a machine needs the firefox and webkit system libraries for them to start
// (`npx playwright install --with-deps firefox webkit`), and this environment has
// only chromium, so enabling them unconditionally would fail every run here.
const crossBrowserProjects =
  process.env.PLAYWRIGHT_CROSS_BROWSER === '1'
    ? [
        {
          name: 'marquee-firefox',
          use: { browserName: 'firefox' as const },
          testMatch: /marquee-selection\.spec\./,
        },
        {
          name: 'marquee-webkit',
          use: { browserName: 'webkit' as const },
          testMatch: /marquee-selection\.spec\./,
        },
      ]
    : [];

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
    ...crossBrowserProjects,
    {
      name: 'persistence',
      // These specs manage their own `wrangler dev --persist-to` instances on
      // their own ports, so they do not use the shared webServer below.
      use: { browserName: 'chromium', baseURL: 'http://localhost:5411' },
      testMatch: /persistence\.spec\.|broken-board\.spec\./,
    },
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
