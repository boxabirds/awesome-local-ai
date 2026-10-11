import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e suite runs against `wrangler dev` serving the built client, which is
 * the same serving path the product uses. The ports come from the environment so
 * the suite stays inside the range allocated to this machine ($AGENT_PORT_FIRST
 * through $AGENT_PORT_LAST); both defaults sit at the bottom of that range.
 */
const PORT = Number(process.env.VIDI6_E2E_PORT ?? process.env.PORT ?? process.env.AGENT_PORT_FIRST ?? 26240);
const INSPECTOR_PORT = Number(process.env.VIDI6_E2E_INSPECTOR_PORT ?? PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// The e2e build has `import.meta.env.MODE === 'test'`, which is what enables the
// `window.__vidi6` navigation hook the far-travel tests need.
const serverCommand = `npm run build:test && npx wrangler dev --config wrangler.jsonc --port ${PORT} --inspector-port ${INSPECTOR_PORT}`;

const VIEWPORT = { width: 1280, height: 800 };

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ],
  webServer: {
    command: serverCommand,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
