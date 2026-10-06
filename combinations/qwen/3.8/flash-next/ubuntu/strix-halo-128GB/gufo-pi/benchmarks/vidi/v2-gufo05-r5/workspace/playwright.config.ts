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
    return CANDIDATES.filter((candidate) =>
      fromMainProcess.split(',').includes(candidate.name),
    ).map((candidate) => ({ name: candidate.name, use: candidate.use }));
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

  process.env.VIDI6_E2E_ENGINES = projects.map((project) => project.name).join(',');
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
    // `--mode test` enables the window.__vidi6 test hook (see src/client/canvas/testHooks.ts).
    command: `npm run build:test && npx wrangler dev --config wrangler.jsonc --ip 127.0.0.1 --port ${PORT} --inspector-port ${INSPECTOR_PORT} --persist-to .wrangler/e2e`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
