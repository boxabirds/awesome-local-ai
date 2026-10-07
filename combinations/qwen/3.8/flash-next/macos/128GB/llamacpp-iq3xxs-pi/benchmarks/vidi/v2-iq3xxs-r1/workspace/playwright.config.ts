import { defineConfig, devices, type Project } from '@playwright/test';

// E2E runs against `wrangler dev` serving the test-mode client build (dist/client).
// `wrangler dev` refuses to share a port, so an overridable pair lets a run use
// the next free slot when something else is already listening here. Both stay
// inside the allocated range (25232-25247).
const PORT = Number(process.env.VIDI6_PORT ?? 25232);
const INSPECTOR_PORT = Number(process.env.VIDI6_INSPECTOR_PORT ?? 25233);
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Which engines to run. This machine cannot launch Firefox or WebKit (recorded in
 * NOTES.md), so the default is Chromium alone rather than a suite that fails for
 * reasons that have nothing to do with the board. `VIDI6_BROWSERS=chromium,firefox,webkit`
 * restores the full matrix on a host that has the browsers installed.
 */
const ALL_BROWSERS = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

const BROWSERS = (process.env.VIDI6_BROWSERS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter((name): name is keyof typeof ALL_BROWSERS => name in ALL_BROWSERS);

const viewport = { width: 1280, height: 800 };

const boardProjects: Project[] = BROWSERS.map((browser) => ({
  name: browser,
  testDir: './tests/e2e',
  // `test:e2e` runs the story suites; the soak scenarios are a separate script.
  grepInvert: /@nightly/,
  use: { ...ALL_BROWSERS[browser], viewport, deviceScaleFactor: 1 },
}));

const nightlyProjects: Project[] = BROWSERS.map((browser, index) => ({
  // The chromium nightly project keeps the stable name the script asks for.
  name: index === 0 ? 'nightly' : `nightly-${browser}`,
  testDir: './tests/e2e-nightly',
  grep: /@nightly/,
  // A 45 second idle window and a 60 second soak are the tests, not timeouts
  // waiting for them; the extra minutes are for a loaded machine.
  timeout: 10 * 60_000,
  use: { ...ALL_BROWSERS[browser], viewport, deviceScaleFactor: 1 },
}));

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    viewport,
    trace: 'off',
  },
  // Fixed 1280x800 CSS-pixel viewport at scale 1 for deterministic one-pixel
  // e2e assertions across all three engines.
  projects: [...boardProjects, ...nightlyProjects],
  webServer: {
    command: `npm run build:test && npx --no-install wrangler dev --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
