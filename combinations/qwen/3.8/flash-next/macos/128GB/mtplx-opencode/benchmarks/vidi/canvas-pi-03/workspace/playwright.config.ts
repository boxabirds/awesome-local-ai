import { defineConfig, devices } from '@playwright/test';

// Static assets served by `wrangler dev` from dist/client, exactly the serving
// path the app ships through. The webServer serves a `--mode test` build (see
// the test:e2e npm script) so the test-only window.__vidi6 hook is present.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8799',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  webServer: {
    command: 'npx wrangler dev --port 8799 --ip 127.0.0.1',
    url: 'http://127.0.0.1:8799/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox and WebKit are listed in the story test strategy but were not
    // installed in this environment; Chromium alone is accepted here.
  ],
});