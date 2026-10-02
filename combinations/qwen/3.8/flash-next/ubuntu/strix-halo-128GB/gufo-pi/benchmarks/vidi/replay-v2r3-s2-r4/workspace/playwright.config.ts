import { defineConfig } from '@playwright/test';

// Story 2 runs the app on a port inside the allowed range for this machine.
const PORT = 28544;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: `vite build --mode test && npx wrangler dev --port ${PORT} --inspector-port ${PORT + 1}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
