import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VIDI6_E2E_PORT ?? 8787);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Tests too slow for every commit live in the `nightly` project (TC-29, TC-30). */
const NIGHTLY_TAG = /@nightly/;

/** Everything that talks to the shared dev server below — which is not story 4. */
const SHARED_SERVER_TESTS = ['**/*.spec.ts', '!**/persistence.spec.ts'];

/**
 * E2E runs against `wrangler dev` serving the built client, so the same serving
 * path is used from day one. The client is built in `test` mode, which is the
 * only build that exposes the `window.__vidi6` camera hook (see design Fixtures).
 *
 * Story 4 is the exception, in its own project and without this server: a test
 * that has to kill the server and bring it back over the same storage cannot
 * share it with the tests running next to it, so that spec starts its own
 * `wrangler dev` per test, on its own port, over its own directory
 * (helpers/wrangler-process.ts). It is kept out of the browser projects so it is
 * not run a second time against the shared server, where it would prove nothing.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: NIGHTLY_TAG,
      testMatch: SHARED_SERVER_TESTS,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      grepInvert: NIGHTLY_TAG,
      testMatch: SHARED_SERVER_TESTS,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      grepInvert: NIGHTLY_TAG,
      testMatch: SHARED_SERVER_TESTS,
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      // One worker: each of these holds a `wrangler dev` process and browsers
      // while it runs, and they are serial because a restart is a global event.
      name: 'persistence',
      testMatch: '**/persistence.spec.ts',
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // `npm run test:e2e:nightly`, and nothing else: the two tests here hold a
      // board open for minutes at a time (design: sync.e2e_nightly).
      name: 'nightly',
      grep: NIGHTLY_TAG,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
