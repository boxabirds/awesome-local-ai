import { defineConfig } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from './src/shared/config';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: E2E_EVENTUAL_TIMEOUT_MS },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:29040',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /live-collaboration\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'nightly',
      testMatch: /nightly/,
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run build:client:test && npx wrangler dev --port 29040 --ip 127.0.0.1',
    url: 'http://127.0.0.1:29040/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
