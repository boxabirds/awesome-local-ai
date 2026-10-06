import {
  chromium,
  defineConfig,
  devices,
  firefox,
  webkit,
  type BrowserType,
  type PlaywrightTestProject,
} from '@playwright/test';

// All servers must listen inside the port range reserved for this agent.
const PORT = Number(process.env.VIDI6_E2E_PORT ?? 28816);
const INSPECTOR_PORT = Number(process.env.VIDI6_E2E_INSPECTOR_PORT ?? PORT + 1);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

interface Candidate {
  name: string;
  browserType: BrowserType;
  use: PlaywrightTestProject['use'];
}

// The story targets desktop Chromium, Firefox and WebKit (Safari) at a laptop viewport.
const CANDIDATES: Candidate[] = [
  {
    name: 'chromium',
    browserType: chromium,
    use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
  },
  {
    name: 'firefox',
    browserType: firefox,
    use: { ...devices['Desktop Firefox'], viewport: VIEWPORT },
  },
  {
    name: 'webkit',
    browserType: webkit,
    use: { ...devices['Desktop Safari'], viewport: VIEWPORT },
  },
];

/**
 * Story 4's tests that own their server (`tests/e2e-restart`): they kill it and start another one
 * over the same storage, which is the only honest way to test "the board was on disk". They ride
 * with Chromium, and they run one at a time because each binds a fixed port pair and reads the
 * storage directory belonging to that server.
 *
 * They are a project inside this config rather than a config of their own because Playwright allows
 * exactly one global web server: the restart tests must leave the shared one alone (never kill it,
 * never clear its storage), so they start servers of their own on other ports, and they are kept
 * out of the browser projects by living in their own test directory.
 */
const RESTART_PROJECT: PlaywrightTestProject = {
  name: 'chromium-restart',
  testDir: './tests/e2e-restart',
  use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
  fullyParallel: false,
  workers: 1,
};

const skipNotice = (name: string): string =>
  `[vidi6] e2e: skipping "${name}" - its browser cannot launch on this host (missing system ` +
  `libraries; try "npx playwright install-deps ${name}"). Its tests stay in the suite and run on ` +
  `a host that has them.`;

async function isLaunchable(browserType: BrowserType): Promise<boolean> {
  try {
    const browser = await browserType.launch({ timeout: 30_000 });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Which engines to run:
 * - `VIDI6_E2E_BROWSERS=chromium,firefox,webkit` pins the list; a pinned engine that cannot
 *   start is an error, so CI can never silently drop a browser.
 * - otherwise every engine whose browser actually starts here is used. Some containers lack
 *   the system libraries Firefox (libgtk-3) and WebKit (GTK, GStreamer, a matching ICU) need,
 *   and an unprivileged user cannot install them; those projects are skipped with a warning.
 *
 * The decision is made once in the main process and handed to worker processes through
 * VIDI6_E2E_ENGINES, because this file is evaluated again inside each worker.
 */
async function resolveProjects(): Promise<PlaywrightTestProject[]> {
  const fromMainProcess = process.env.VIDI6_E2E_ENGINES;
  if (fromMainProcess !== undefined) {
    const engines = fromMainProcess.split(',');
    return [
      ...CANDIDATES.filter((candidate) => engines.includes(candidate.name)).map((candidate) => ({
        name: candidate.name,
        use: candidate.use,
      })),
      // the restart project rides on Chromium, so workers are told about it the same way
      ...(engines.includes('chromium') ? [RESTART_PROJECT] : []),
    ];
  }

  const pinned = (process.env.VIDI6_E2E_BROWSERS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const candidates = pinned.length
    ? CANDIDATES.filter((candidate) => pinned.includes(candidate.name))
    : CANDIDATES;

  const projects: PlaywrightTestProject[] = [];
  for (const candidate of candidates) {
    if (await isLaunchable(candidate.browserType)) {
      projects.push({ name: candidate.name, use: candidate.use });
    } else if (pinned.length) {
      throw new Error(
        `e2e: "${candidate.name}" was pinned through VIDI6_E2E_BROWSERS but its browser ` +
          `cannot launch on this host`,
      );
    } else {
      console.warn(skipNotice(candidate.name));
    }
  }

  const engines = projects.map((project) => project.name);
  // the restart tests need a launchable browser too, and Chromium is the one they are written for
  if (engines.includes('chromium')) {
    projects.push(RESTART_PROJECT);
  } else {
    console.warn(
      '[vidi6] e2e: skipping "chromium-restart" - its browser cannot launch on this host.',
    );
  }
  process.env.VIDI6_E2E_ENGINES = engines.join(',');
  return projects;
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // The nightly scenarios (TC-29 idle stability, TC-30 capacity soak) are minutes of waiting, so
  // the everyday run leaves them out and `npm run test:e2e:nightly` runs only those.
  grep: process.env.VIDI6_NIGHTLY ? /@nightly/ : undefined,
  grepInvert: process.env.VIDI6_NIGHTLY ? undefined : /@nightly/,
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'off',
  },
  projects: await resolveProjects(),
  webServer: {
    // Serve the client through the same path production uses: `wrangler dev` over dist/client.
    // `--mode test` enables the window.__vidi6 test hook (see src/client/canvas/testHooks.ts), and
    // `--var TEST_HOOKS:1` the Worker's storage hooks (see src/worker/test-hooks.ts). Neither is in
    // wrangler.jsonc, so a production deploy has neither; a reused server started without them will
    // make the storage test fail rather than pass quietly.
    command: `npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --persist-to .wrangler/e2e --var TEST_HOOKS:1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
