import { defineConfig, devices } from '@playwright/test';

// e2e runs against `wrangler dev` serving the static client build (see
// package.json "e2e:serve"), so the same serving path is used from day one.
const port = Number(process.env.VIDI6_E2E_PORT ?? 20784);
const baseURL = `http://127.0.0.1:${port}`;
const viewport = { width: 1280, height: 800 };

// The design's browser matrix is Chromium, Firefox and WebKit. Firefox and
// WebKit cannot start inside some sandboxes (both abort during launch there),
// so they are opt-in: VIDI6_E2E_PROJECTS=chromium,firefox,webkit npm run test:e2e
// runs the full matrix, the default runs the Chromium that always works here.
const allProjects = {
  chromium: { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport } },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'], viewport } },
};

const selected = (process.env.VIDI6_E2E_PROJECTS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name in allProjects);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    baseURL,
    viewport,
    trace: 'off',
    video: 'off',
  },
  projects: selected.map((name) => allProjects[name as keyof typeof allProjects]),
  webServer: {
    command: process.env.VIDI6_E2E_SERVE ?? 'npm run e2e:serve',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
