import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.AGENT_PORT_FIRST ? Number(process.env.AGENT_PORT_FIRST) : 8787;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.{ts,tsx}',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build && npx wrangler dev --port=${PORT}`,
    port: PORT,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
