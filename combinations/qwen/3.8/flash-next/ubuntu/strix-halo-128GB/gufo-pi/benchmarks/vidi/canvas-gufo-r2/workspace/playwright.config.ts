import { defineConfig, devices } from '@playwright/test';

/**
 * End to end configuration. The web server is a production build of the client
 * served by `wrangler dev` (the same static asset serving used in production).
 *
 * Chromium runs by default. Firefox and WebKit are configured per the design
 * ("Chromium, Firefox and WebKit, Playwright defaults") but need system
 * libraries that are not present everywhere — set `E2E_ALL_BROWSERS=1`
 * (`npm run test:e2e:all`) to run them, after `playwright install-deps`.
 */
const allBrowsers = process.env.E2E_ALL_BROWSERS === '1';
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on-first-retry',
    viewport,
  },
  webServer: {
    command: 'npm run build:test && npx wrangler dev --ip 127.0.0.1 --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
    ...(allBrowsers
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
          { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
        ]
      : []),
  ],
});
