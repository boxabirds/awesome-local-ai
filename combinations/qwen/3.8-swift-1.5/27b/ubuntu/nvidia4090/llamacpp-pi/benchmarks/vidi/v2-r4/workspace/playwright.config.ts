import { defineConfig } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const persistDir = path.join(__dirname, '.e2e-persist');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8787',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `npx wrangler dev --port 8787 --ip 127.0.0.1 --persist-to ${persistDir}`,
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 30000,
  },
  globalSetup: async () => {
    // Clean up persist directory before each run
    if (fs.existsSync(persistDir)) {
      fs.rmSync(persistDir, { recursive: true, force: true });
    }
  },
});
