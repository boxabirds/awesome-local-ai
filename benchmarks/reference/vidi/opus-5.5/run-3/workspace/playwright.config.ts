import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;

// Firefox's own macOS sandbox cannot initialise when the test runner is itself sandboxed
// (sandbox_init "Operation not permitted"), so the test browser runs with it disabled.
const FIREFOX_NO_SANDBOX_ENV = Object.fromEntries(
  ['CONTENT', 'GMP', 'RDD', 'SOCKET_PROCESS', 'UTILITY', 'GPU'].map((k) => [`MOZ_DISABLE_${k}_SANDBOX`, '1']),
);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  // Long idle / soak specs live in tests/e2e/nightly and run only in the `nightly` project
  // (`npm run test:e2e:nightly`); `npm run test:e2e` runs the browser projects, which ignore them.
  // tests/e2e/persistence.spec.ts starts and kills its own `wrangler dev --persist-to` processes and runs only in
  // the `persistence` project (chromium).
  testIgnore: ['**/nightly/**', '**/persistence.spec.ts'],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          env: { ...process.env, ...FIREFOX_NO_SANDBOX_ENV },
          firefoxUserPrefs: { 'security.sandbox.content.level': 0 },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'persistence',
      testIgnore: '**/nightly/**',
      testMatch: '**/persistence.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'nightly',
      testIgnore: [],
      testMatch: '**/nightly/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  // `npm run test:e2e` builds the client in test mode (enables window.__vidi6) before this runs.
  // TEST_HOOKS=1 enables the test-only storage hooks (/__test/*) used by the broken-board spec.
  webServer: {
    command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var TEST_HOOKS:1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
