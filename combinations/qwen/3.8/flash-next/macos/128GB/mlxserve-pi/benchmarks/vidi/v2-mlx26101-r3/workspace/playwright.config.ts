import { defineConfig, devices, type Project } from '@playwright/test';

const E2E_PORT = Number(process.env.E2E_PORT ?? 23614);
const E2E_INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? E2E_PORT + 1);
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

/**
 * The design asks for Chromium, Firefox and WebKit. All three projects are configured, but
 * only Chromium can actually start inside this coding sandbox: the bundled Firefox and
 * WebKit binaries abort on launch here (SIGABRT), which is a sandbox restriction rather
 * than a product problem. Run `BROWSERS=all npm run test:e2e` to exercise all three on a
 * machine where they can start; see NOTES.md.
 */
function projects(): Project[] {
  const chromium: Project = {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
  };
  if (process.env.BROWSERS !== 'all') {
    return [chromium];
  }
  return [
    chromium,
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
  ];
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
  },
  projects: projects(),
  // The two tests that are long on purpose - a board left alone for half a minute, and a full
  // room editing continuously for a minute - are tagged `@nightly` and kept out of the ordinary
  // run in both directions: `npm run test:e2e` does not wait for them, and
  // `npm run test:e2e:nightly` runs nothing else. They are tagged rather than filed somewhere
  // else, because they belong next to the tests they are bigger versions of.
  ...(process.env.NIGHTLY === undefined ? { grepInvert: /@nightly/ } : { grep: /@nightly/ }),
  // The bundle is built before any test runs, not as part of the server command: see
  // tests/e2e/global-setup.ts for why that order matters when a server is reused.
  globalSetup: 'tests/e2e/global-setup.ts',
  webServer: {
    // Story 1 serves the client through the same path later stories use: a Cloudflare
    // Worker (wrangler) serving the static assets in dist/client.
    command: `npx wrangler dev --ip 127.0.0.1 --port ${E2E_PORT} --inspector-port ${E2E_INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
