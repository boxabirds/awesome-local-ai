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

// The nightly suite: the two checks that take minutes rather than seconds (an idle
// connection, and a soak at full capacity). It is a project of its own, run by
// `npm run test:e2e:nightly`, and it is kept out of the suite that runs on every commit by
// the `testIgnore` below — a commit should not have to wait 45 seconds for a connection to
// sit still. It runs on Chromium whatever the browser matrix is, because that is the
// browser that always starts in here.
const nightly = {
  name: 'nightly',
  testDir: './tests/e2e/nightly',
  testIgnore: [] as string[],
  use: { ...devices['Desktop Chrome'], viewport },
};

// Story 4's restart tests. They cannot share the suite's server, because the whole point of
// them is that the server is stopped and another one is started in its place; they bring a
// `wrangler dev` of their own, on ports 20796/20797 and a storage directory of their own.
// Chromium, whatever the matrix is: it is the browser that always starts in here.
const persistence = {
  name: 'persistence',
  testDir: './tests/e2e/persistence',
  // The root `testIgnore` keeps this directory out of the browser projects, which is how a
  // commit avoids running a restart twice per browser. Inside its own project the files are
  // exactly the ones wanted.
  testIgnore: [] as string[],
  use: { ...devices['Desktop Chrome'], viewport },
};

const selected = (process.env.VIDI6_E2E_PROJECTS ?? 'chromium')
  .split(',')
  .map((name) => name.trim())
  .filter((name) => name in allProjects);

export default defineConfig({
  testDir: './tests/e2e',
  // Everything under tests/e2e/nightly belongs to the nightly project and to nothing else.
  testIgnore: [/[/\\]nightly[/\\]/, /[/\\]persistence[/\\]/],
  fullyParallel: true,
  // Each test opens a browser context per person, so the worker count is roughly the
  // number of browsers open at once. Four is plenty for the suite and keeps one machine
  // from being the thing that makes a change slow.
  workers: Number(process.env.VIDI6_E2E_WORKERS ?? 4),
  reporter: [['list']],
  // Prints what the run measured, once the browsers are gone (see the file).
  globalTeardown: './tests/e2e/helpers/latency-report.ts',
  outputDir: './test-results',
  use: {
    baseURL,
    viewport,
    trace: 'off',
    video: 'off',
  },
  projects: [
    ...selected.map((name) => allProjects[name as keyof typeof allProjects]),
    nightly,
    persistence,
  ],
  webServer: {
    command: process.env.VIDI6_E2E_SERVE ?? 'npm run e2e:serve',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
