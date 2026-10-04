import { defineConfig, devices, type Project } from '@playwright/test';

const E2E_PORT = Number(process.env.E2E_PORT ?? 23614);
const E2E_INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? E2E_PORT + 1);
const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
// Story 4's tests serve on a port of their own, because the server they test is theirs: they stop
// it and start it again, and a port is the one thing two servers cannot share. This is only where
// that server starts looking for a free one - the port it ends up with is the process's own
// (`server.origin`, given to every page) - see the note on PORT in tests/e2e/persistence.spec.ts.
const PERSIST_PORT = Number(process.env.PERSIST_E2E_PORT ?? 49_701);
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
    // Story 4's tests start and stop their own server, on their own port, and are run by the
    // project below. Handing them this one would have them open a board on the server this file's
    // webServer owns, which is the one thing a test about a service losing its memory must not do.
    testIgnore: 'persistence.spec.ts',
  };
  // The persistence project is chromium-only: the story is about storage and about a board opening,
  // and a browser engine does not change either. The other two are configured above for the tests
  // that are about what a person sees.
  const persistence: Project = {
    name: 'persistence',
    testMatch: 'persistence.spec.ts',
    use: {
      baseURL: `http://127.0.0.1:${PERSIST_PORT}`,
      ...devices['Desktop Chrome'],
      viewport: VIEWPORT,
    },
  };
  if (process.env.BROWSERS !== 'all') {
    return [chromium, persistence];
  }
  return [
    chromium,
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
    persistence,
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
    //
    // TEST_HOOKS turns on the damage switches in src/worker/test-hooks.ts, which the broken-board
    // test uses to take a saved board apart. They are on for the suite and for the suite only:
    // `wrangler.jsonc` does not define the variable, so `npm run dev` and a deployment have no such
    // route. See tests/e2e/broken-board.spec.ts.
    command: `npx wrangler dev --ip 127.0.0.1 --port ${E2E_PORT} --inspector-port ${E2E_INSPECTOR_PORT} --var TEST_HOOKS:1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
