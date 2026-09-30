import { defineConfig, devices } from '@playwright/test';

/** E2E runs against the same serving path as production: `wrangler dev`
 * serving the built client from `dist/client` (design: Mock vs real boundaries). */
const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    // An interaction that cannot happen says so in twenty seconds rather than
    // eating the whole test budget: a covered button, a note that never opens.
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // Test mode build so the `window.__vidi6` test hook is present (design: Fixtures).
    command: `npm run build:test && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: VIEWPORT,
        // Firefox installs its own macOS process sandbox, which cannot start
        // inside some restricted sandboxes (sandbox_init() -> "Operation not
        // permitted"), where Firefox would not launch at all. Disabling it does
        // not affect what these tests measure.
        launchOptions: {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: '1',
            MOZ_DISABLE_GPU_SANDBOX: '1',
            MOZ_DISABLE_SOCKET_PROCESS_SANDBOX: '1',
            MOZ_DISABLE_RDD_SANDBOX: '1',
          },
        },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: VIEWPORT },
    },
  ],
});
