import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 1280, height: 800 };
const nightly = process.env.E2E_NIGHTLY === '1';

export default defineConfig({
  testDir: 'tests/e2e',
  // Long-running soak/idle tests live in tests/e2e/nightly and run only via `npm run test:e2e:nightly`.
  testMatch: nightly ? '**/nightly/*.spec.ts' : '**/*.spec.ts',
  testIgnore: nightly ? undefined : ['**/nightly/**', '**/persistence.spec.ts'],
  use: { baseURL: 'http://localhost:8787', viewport },
  webServer: {
    command: 'npx wrangler dev --port 8787 --var TEST_HOOKS:1',
    url: 'http://localhost:8787',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
  ],
});
