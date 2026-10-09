import { defineConfig, devices } from '@playwright/test';

/**
 * The persistence suite runs its own `wrangler dev` processes (see
 * `tests/e2e/helpers/wrangler-process.ts`): the tests are about what survives a
 * process dying, which a shared webServer cannot survive. One project, one browser
 * (Chromium — the storage behaviour under test is the worker's, not the browser's),
 * and no `webServer` at all: the spec owns the server, port and all.
 */
const PORT = Number(process.env.AGENT_PORT_E2E_PERSIST ?? 27428);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  testMatch: ['persistence.spec.ts', 'broken-board.spec.ts'],
  timeout: 300_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  projects: [{ name: 'persistence', use: { ...devices['Desktop Chrome'] } }],
});
