import { defineConfig } from '@playwright/test'

const port = parseInt(process.env.AGENT_PORT_FIRST || '22208', 10)

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 30000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `wrangler dev --port=${port} --ip=127.0.0.1`,
    port,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
})
