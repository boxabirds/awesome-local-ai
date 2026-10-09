import { defineConfig } from '@playwright/test';

// Persistence end-to-end runs against a wrangler dev process that the spec
// itself starts, kills and restarts with --persist-to, so the reload-after-
// restart behaviour is exercised through a real restart rather than a stub.
// It therefore uses its own config without a webServer block and a distinct
// port pair.
const PORT = Number(process.env.VIDI6_E2E_PORT ?? 27618);
const INSPECTOR_PORT = Number(process.env.VIDI6_INSPECTOR_PORT ?? 27619);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /persistence\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 240_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`
  },
  projects: [
    {
      name: 'chromium',
      use: { viewport: { width: 1280, height: 800 } }
    }
  ]
});
