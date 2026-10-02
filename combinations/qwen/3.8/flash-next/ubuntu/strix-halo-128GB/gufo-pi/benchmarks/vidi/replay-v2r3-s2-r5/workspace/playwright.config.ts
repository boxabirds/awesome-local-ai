import { defineConfig } from '@playwright/test';

// Every server in this repo listens inside the allowed port window
// (AGENT_PORT_FIRST..AGENT_PORT_LAST); 5173 would be outside it.
const E2E_PORT = Number(process.env.E2E_PORT ?? 29328);

// Chromium by default. Firefox and WebKit are installed but cannot start on this
// machine (missing system libraries, no root) - see NOTES.md. Run them with
// E2E_BROWSERS=chromium,firefox,webkit once the dependencies exist.
const BROWSERS = (process.env.E2E_BROWSERS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: BROWSERS.map((name) => ({
    name,
    use: { browserName: name as 'chromium' | 'firefox' | 'webkit' },
  })),
  webServer: {
    command: `vite build --mode test && npx wrangler dev --port ${E2E_PORT}`,
    port: E2E_PORT,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
