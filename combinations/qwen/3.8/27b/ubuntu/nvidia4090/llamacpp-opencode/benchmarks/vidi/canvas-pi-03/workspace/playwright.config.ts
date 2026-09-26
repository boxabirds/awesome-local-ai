import { defineConfig, devices } from '@playwright/test';

/**
 * Story 3 e2e runs against the REAL worker + Durable Object + WebSocket path:
 * the web server is `wrangler dev` (which serves the built client AND the
 * `/api/rooms` WebSocket upgrade). `vite preview` cannot proxy the worker, so
 * it is not used here.
 *
 * The nightly project (idle stability + capacity soak) is excluded from the
 * default `test:e2e` (which targets `--project chromium` only).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      // The persistence specs manage their own wrangler per test (separate
      // process, port 8791) and must run sequentially; they live in their
      // own config (playwright.persist.config.ts, workers: 1).
      testIgnore: ['**/nightly/**', '**/persistence/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-nightly',
      testMatch: '**/nightly/**',
      use: { ...devices['Desktop Chrome'] },
    },
    // Story 7: TC-32 (marquee containment) must also pass in firefox and
    // webkit. Only the marquee spec is targeted; the other selection tests
    // are chromium per the spec. Story 11: TC-17 (real-drag preview) must
    // also pass there, so the pen spec is targeted as well. Story 12: TC-26
    // (mixed picker batch + validation toasts) is cross-browser; the image
    // spec's other workflows are chromium-only (skipped off-chromium).
    {
      name: 'firefox',
      testMatch: ['**/selection-marquee.spec.ts', '**/text-wrapping.spec.ts', '**/pen.spec.ts', '**/image.spec.ts'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: ['**/selection-marquee.spec.ts', '**/text-wrapping.spec.ts', '**/pen.spec.ts', '**/image.spec.ts'],
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // Story 5: TEST_HOOKS enables the /__test routes (board initialize for
    // the openBoard helper, legacy seeding for TC-31) and the x-test-visitor
    // rate-limit override used to keep parallel e2e creations independent.
    command: 'npm run build:e2e && npx wrangler dev --port 8787 --local --var TEST_HOOKS:1',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
