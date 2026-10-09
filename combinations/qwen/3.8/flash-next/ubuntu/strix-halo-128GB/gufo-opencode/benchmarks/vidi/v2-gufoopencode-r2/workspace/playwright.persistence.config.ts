import { defineConfig, devices } from '@playwright/test';
import { chromiumLaunchOptions } from './playwright.launch';

// Story 4 persistence specs. They do NOT get a shared webServer: each test
// starts and kills its own `wrangler dev` over a fresh --persist-to directory
// (tests/e2e/helpers/wrangler-process.ts), so restarts are real process
// restarts. Own port pair to stay clear of the default and nightly servers.
const PORT = Number(process.env.E2E_PERSIST_PORT ?? 29434);
const INSPECTOR_PORT = Number(process.env.E2E_PERSIST_INSPECTOR_PORT ?? 29435);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e/persistence',
  timeout: 10 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
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
});
