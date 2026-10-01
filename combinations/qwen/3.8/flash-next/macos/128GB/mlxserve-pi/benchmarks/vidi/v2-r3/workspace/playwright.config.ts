import { defineConfig, devices } from '@playwright/test';

// E2E runs against `wrangler dev` serving the static client build (the same
// serving path production will use). The build is made with
// `vite build --mode test` so the window.__vidi6 test hook is included.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  // A story-3 test is two to five browsers on one board, and every one of them
  // is measured against how long a change takes to cross them. Four at a time
  // keeps those numbers worth reading on a machine also running the room.
  workers: 4,
  // Two families are kept out of the ordinary browser projects: the nightly soak
  // (its own script), and the persistence specs, which own their own `wrangler
  // dev` process — they start and stop a server on their own ports and must not
  // be run once per browser or fight the shared webServer for a port.
  testIgnore: [/nightly/, /(persistence|broken-board)\.spec/],
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
  },
  webServer: {
    command: 'npm run build:test && npx wrangler dev --port 4173 --ip 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { CI: '1', WRANGLER_SEND_METRICS: 'false' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      // Note: firefox cannot launch in some sandboxed macOS CI boxes; the
      // test:e2e script runs chromium + webkit. Use `npx playwright test
      // --project=firefox` where firefox is runnable.
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Story 4: boards survive a service restart, an empty room, the tested size,
      // and an unreadable board. Each test drives its own `wrangler dev` process
      // (started, killed and restarted in the spec), so it runs once, on chromium,
      // and is excluded from the three browser projects above.
      name: 'persistence',
      testIgnore: [],
      testMatch: /(persistence|broken-board)\.spec/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // The two long checks: an idle connection watched for longer than it takes
      // to notice a dead one, and a minute of editing at full capacity. One
      // browser is enough for a wait, and it is the browser the product's own
      // numbers were chosen against.
      name: 'nightly',
      testIgnore: [],
      testMatch: /nightly/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
