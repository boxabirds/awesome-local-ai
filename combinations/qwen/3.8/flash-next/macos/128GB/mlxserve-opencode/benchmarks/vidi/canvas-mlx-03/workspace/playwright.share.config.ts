// Playwright config for story 5's share workflows (`npm run test:e2e:share`).
//
// Separate from the room/reconnect and persistence suites because this story owns
// a rate limit that is counted per Worker process and per visitor: sharing a server
// with other suites would make TC-30's boundary depend on unrelated traffic (that
// test boots a Worker of its own anyway). The suite therefore boots its own
// `wrangler dev` — with `--var VIDI_TEST_HOOKS:1`, so seeded boards do not spend the
// creation limit (tests/e2e/helpers/wrangler-process.ts).
//
// Coverage (design "Done when": all pass in chromium; TC-27 and TC-29 also in
// firefox and webkit): chromium runs the whole file, firefox and webkit are
// restricted to those two by test-title grep. Those two are the engine-specific
// halves of the story — a link that goes nowhere, and a clipboard that refuses —
// where a fallback path has to work rather than being asserted against Chromium's
// permissive clipboard.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /share\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 2,
  // Board opening is asserted against a wall clock, and a cold `wrangler dev` on a
  // loaded machine is the slow part; give each test room for that.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  // The same project setup as the room/reconnect suite, including Firefox's
  // sandbox workaround; see playwright.config.ts.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: '1',
            MOZ_DISABLE_GPU_SANDBOX: '1',
          },
        },
      },
      grep: /TC-27|TC-29/,
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /TC-27|TC-29/ },
  ],
});
