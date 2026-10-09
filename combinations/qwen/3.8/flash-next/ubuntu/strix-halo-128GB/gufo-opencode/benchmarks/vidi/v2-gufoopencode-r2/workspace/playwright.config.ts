import { defineConfig, devices } from '@playwright/test';

// All servers must bind ports inside $AGENT_PORT_FIRST..$AGENT_PORT_LAST (29424-29439).
const PORT = Number(process.env.E2E_PORT ?? 29430);
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? 29431);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // Serve the client through the real serving path from day one (design: Mock vs real).
    // Test-mode build so the window.__vidi6 test hook is included (excluded from production build).
    command: `npm run build:test && CI=1 npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --config wrangler.jsonc`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 180_000,
  },
});
