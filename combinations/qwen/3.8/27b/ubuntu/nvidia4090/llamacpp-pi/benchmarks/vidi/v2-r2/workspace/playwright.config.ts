import { defineConfig } from '@playwright/test';

// Servers started by the e2e suite must listen on ports from
// $AGENT_PORT_FIRST..$AGENT_PORT_LAST (see NOTES.md).
const AGENT_PORT_FIRST = Number(process.env.AGENT_PORT_FIRST ?? 29104);
const AGENT_PORT_LAST = Number(process.env.AGENT_PORT_LAST ?? 29104);

// wrangler dev (the e2e webServer) uses offset 1 of the agent port range.
const WRANGLER_DEV_PORT = AGENT_PORT_FIRST + 1;
if (WRANGLER_DEV_PORT < AGENT_PORT_FIRST || WRANGLER_DEV_PORT > AGENT_PORT_LAST) {
  throw new Error(`wrangler dev port ${WRANGLER_DEV_PORT} is outside the allowed range`);
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${WRANGLER_DEV_PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  // Nightly specs (45 s idle + 60 s capacity soak) run in their own project
  // (test:e2e:nightly) so every-commit e2e stays fast.
  projects: [
    {
      name: 'chromium',
      testMatch: /^(?!.*nightly).*\.spec\.ts$/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      testMatch: /^(?!.*nightly).*\.spec\.ts$/,
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      testMatch: /^(?!.*nightly).*\.spec\.ts$/,
      use: { browserName: 'webkit' },
    },
    {
      name: 'nightly',
      testMatch: /nightly.*\.spec\.ts$/,
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    // Serve the same static assets path the production Worker will serve:
    // build a test-mode client (window.__vidi6 test hook enabled), then
    // serve dist/client with wrangler dev.
    command: `npm run build:e2e && npx wrangler dev --port ${WRANGLER_DEV_PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${WRANGLER_DEV_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
