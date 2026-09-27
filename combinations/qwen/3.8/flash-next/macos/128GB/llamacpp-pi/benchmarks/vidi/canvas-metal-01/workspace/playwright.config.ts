import { existsSync } from 'node:fs';

import { chromium, defineConfig, devices, firefox, webkit } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8787);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
/** Design fixture: every project runs at a 1280x800 laptop viewport. */
const VIEWPORT = { width: 1280, height: 800 };

/**
 * Only run browser projects whose binaries are installed, so `npm run test:e2e`
 * works on a machine that has a subset of the three engines. Override the list
 * explicitly with e.g. `BROWSERS=chromium npm run test:e2e`.
 */
const engines = [
  {
    name: 'chromium',
    browser: chromium,
    device: devices['Desktop Chrome'],
    use: {},
  },
  {
    name: 'firefox',
    browser: firefox,
    device: devices['Desktop Firefox'],
    // The bundled Firefox cannot create its macOS sandbox inside a restricted CI
    // sandbox; without this the browser process refuses to start.
    use: {
      launchOptions: {
        env: {
          ...process.env,
          MOZ_DISABLE_CONTENT_SANDBOX: '1',
          MOZ_DISABLE_GPU_SANDBOX: '1',
        },
      },
    },
  },
  {
    name: 'webkit',
    browser: webkit,
    device: devices['Desktop Safari'],
    use: {},
  },
];

const projects = engines
  .filter(({ name, browser }) => {
    const requested = process.env.BROWSERS?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (requested && !requested.includes(name)) return false;
    try {
      return existsSync(browser.executablePath());
    } catch {
      return false;
    }
  })
  .map(({ name, device, use }) => ({
    name,
    use: { ...device, viewport: VIEWPORT, baseURL: BASE_URL, ...use },
  }));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    viewport: VIEWPORT,
    trace: 'off',
  },
  // Static assets are served by `wrangler dev` from `dist/client`, the same path
  // production uses (design: "Static assets served by wrangler dev in e2e").
  // `build:test` produces a test build, i.e. one that keeps window.__vidi6.
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip ${HOST} --port ${PORT} --config wrangler.jsonc`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { CI: '1', WRANGLER_LOG: 'warn', WRANGLER_SEND_METRICS: 'false' },
  },
  projects:
    projects.length > 0
      ? projects
      : [
          {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: BASE_URL },
          },
        ],
});
