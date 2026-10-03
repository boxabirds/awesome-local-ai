import { defineConfig } from '@playwright/test';

// All three browser projects from the design are declared; E2E_BROWSERS lets a
// machine without a given browser engine run the rest (see NOTES.md).
const ALL_PROJECTS = ['chromium', 'firefox', 'webkit'] as const;
const enabled = (process.env.E2E_BROWSERS ?? ALL_PROJECTS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter((name): name is (typeof ALL_PROJECTS)[number] =>
    (ALL_PROJECTS as readonly string[]).includes(name),
  );

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:25504',
    viewport: { width: 1280, height: 800 },
  },
  projects: enabled.map((name) => ({
    name,
    use: { browserName: name },
  })),
  webServer: {
    command: 'npx wrangler dev --port 25504 --ip 127.0.0.1 --inspector-port 25505',
    url: 'http://127.0.0.1:25504',
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
