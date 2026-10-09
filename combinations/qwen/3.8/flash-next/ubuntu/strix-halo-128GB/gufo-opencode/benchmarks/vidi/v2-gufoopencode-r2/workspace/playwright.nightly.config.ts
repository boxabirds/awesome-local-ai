import { defineConfig, devices } from '@playwright/test';
import { chromiumLaunchOptions } from './playwright.launch';

// Nightly-only specs (idle stability TC-29, capacity soak TC-30). Longer
// timeouts and their own ports so a default `npm run test:e2e` run never
// collides. Run: npm run test:e2e:nightly
const PORT = Number(process.env.E2E_NIGHTLY_PORT ?? 29432);
const INSPECTOR_PORT = Number(process.env.E2E_NIGHTLY_INSPECTOR_PORT ?? 29433);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e/nightly',
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    actionTimeout: 4000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: chromiumLaunchOptions(),
      },
    },
  ],
  webServer: {
    command: `npm run build:test && CI=1 npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --config wrangler.jsonc`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
  },
});
