import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Everything listens on ports from $AGENT_PORT_FIRST..$AGENT_PORT_LAST (21056-21071).
const PORT = Number(process.env['E2E_PORT'] ?? 21062);
const INSPECTOR_PORT = Number(process.env['E2E_INSPECTOR_PORT'] ?? PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Design fixture: a default laptop board area. */
const VIEWPORT = { width: 1280, height: 800 };
const AVAILABILITY_FILE = 'test-results/browser-availability.json';

/**
 * Ask once, at config time, which browsers can actually start. Some sandboxes
 * can only run Chromium; the result is written to $AVAILABILITY_FILE and the
 * tests for a browser that cannot launch skip themselves with that reason
 * instead of reporting a false failure.
 */
function probeBrowsers(): Record<string, boolean> {
  const script = `
    const { chromium, firefox, webkit } = require('@playwright/test');
    (async () => {
      const result = {};
      for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
        result[name] = await type.launch()
          .then(async (browser) => { await browser.close(); return true; })
          .catch(() => false);
      }
      process.stdout.write(JSON.stringify(result));
    })();
  `;
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      timeout: 180_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(stdout.slice(stdout.indexOf('{'))) as Record<string, boolean>;
  } catch {
    return {};
  }
}

const availability = probeBrowsers();
mkdirSync('test-results', { recursive: true });
writeFileSync(AVAILABILITY_FILE, `${JSON.stringify(availability, null, 2)}\n`);
const unusable = Object.entries(availability)
  .filter(([, usable]) => !usable)
  .map(([name]) => name);
if (unusable.length > 0) {
  console.warn(
    `[e2e] these browsers cannot start in this environment, their tests will be skipped: ${unusable.join(', ')}`,
  );
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e-artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Static assets are served by `wrangler dev`, the same serving path the app
  // will use from story 3 on. The build is made in `test` mode so the test-only
  // camera hook is present.
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --log-level warn`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.nightly\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
    {
      name: 'firefox',
      testIgnore: /\.nightly\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'], viewport: VIEWPORT },
    },
    {
      name: 'webkit',
      testIgnore: /\.nightly\.spec\.ts$/,
      use: { ...devices['Desktop Safari'], viewport: VIEWPORT },
    },
    // TC-29 and TC-30: the long ones. `npm run test:e2e:nightly` runs this project
    // and `npm run test:e2e` runs the three above, which ignore these files. One
    // browser only: a nightly is a soak, and it is the board being soaked, not the
    // browser engines.
    {
      name: 'nightly',
      testMatch: /\.nightly\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
});
