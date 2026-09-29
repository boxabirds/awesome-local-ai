import { defineConfig, devices } from '@playwright/test';

const PORT = 5178;
const BASE_URL = `http://localhost:${PORT}`;

// The e2e app is served the same way it will be in production: a built static
// client served by `wrangler dev`. We build in test mode so the window.__vidi6
// camera hook is available to jump far away (TC-26, TC-27).
export default defineConfig({
  testDir: 'tests/e2e',
  // Long-running nightly specs (TC-29, TC-30) run only via test:e2e:nightly.
  testIgnore: /\.nightly\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30000,
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `npm run build:test && npx wrangler dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        // Firefox's nested OS sandbox cannot initialise inside some sandboxed
        // CI hosts (macOS Seatbelt `sandbox_init` denial). Disabling the content
        // sandbox is behaviour-neutral for these tests and lets the project run
        // there; the vars are ignored on hosts that permit the sandbox.
        launchOptions: {
          env: {
            ...process.env,
            MOZ_DISABLE_CONTENT_SANDBOX: '1',
            MOZ_DISABLE_GPU_SANDBOX: '1',
          },
        },
      },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } } },
  ],
});
