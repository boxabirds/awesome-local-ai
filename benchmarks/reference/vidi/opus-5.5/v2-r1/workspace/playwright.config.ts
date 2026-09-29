import { defineConfig, devices } from '@playwright/test';

const PORT = 8788;
const viewport = { width: 1280, height: 800 };
// Comma-separated subset of browsers to run, e.g. E2E_BROWSERS=chromium,webkit (default: all three).
const browsers = (process.env.E2E_BROWSERS ?? 'chromium,firefox,webkit').split(',');

// Slow nightly suites (tests/e2e/nightly) run only via `npm run test:e2e:nightly`.
const nightly = !!process.env.E2E_NIGHTLY;
// Starts, kills and restarts its own `wrangler dev` processes: its own project, Chromium only.
const PERSISTENCE_SPEC = '**/persistence.spec.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: nightly ? [] : ['**/nightly/**'],
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport,
  },
  projects: [
    ...[
      { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
      { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
    ]
      .filter((p) => browsers.includes(p.name))
      .map((p) => ({ ...p, testIgnore: [...(nightly ? [] : ['**/nightly/**']), PERSISTENCE_SPEC] })),
    ...(nightly
      ? []
      : [
          {
            name: 'persistence',
            testMatch: PERSISTENCE_SPEC,
            use: { ...devices['Desktop Chrome'], viewport },
          },
        ]),
  ],
  webServer: {
    // Test-mode build exposes window.__vidi6 (test hook); served the same way as production.
    // TEST_HOOKS enables the storage corruption/repair routes (src/worker/test-hooks.ts).
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var TEST_HOOKS:1`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
