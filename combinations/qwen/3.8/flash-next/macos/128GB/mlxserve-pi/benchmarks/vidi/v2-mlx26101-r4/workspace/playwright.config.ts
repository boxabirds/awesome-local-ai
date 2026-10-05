import { defineConfig, devices } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Ports stay inside the range allocated to this machine (see NOTES.md). The first pair
// in that range that is actually free is used, rather than the pinned one, because a
// runtime left behind by an earlier run cannot always be stopped from here (a `wrangler
// dev` started in another shell session owns a process this one may not signal), and
// such a leftover answers on `/` while serving the bundle it read at startup — it 404s
// the file this run just built, which Playwright would report as a broken app.
const PORT_RANGE = { from: 22880, to: 22895 };

interface PortPair {
  e2e: number;
  inspector: number;
}

/**
 * The port pair this run should use, shared with every Playwright worker.
 *
 * Each worker reads the configuration again in its own process, and a port that is
 * free in one of them may be taken by this run's own server in another. So the first
 * process to decide publishes the choice in the environment, which the workers it
 * spawns inherit: one answer for the whole run.
 */
function pickPorts(): PortPair {
  const fromEnv = Number.parseInt(process.env.VIDI6_E2E_PORT ?? '', 10);
  const inspectorFromEnv = Number.parseInt(process.env.VIDI6_E2E_INSPECTOR ?? '', 10);
  if (
    Number.isInteger(fromEnv) &&
    fromEnv >= PORT_RANGE.from &&
    fromEnv + 1 <= PORT_RANGE.to &&
    Number.isInteger(inspectorFromEnv)
  ) {
    return { e2e: fromEnv, inspector: inspectorFromEnv };
  }

  const fallback: PortPair = { e2e: PORT_RANGE.from, inspector: PORT_RANGE.from + 1 };
  const script = `
    import { createServer } from 'node:net';
    const bind = (port) =>
      new Promise((done) => {
        const server = createServer();
        server.once('error', () => done(null));
        server.listen({ host: '127.0.0.1', port }, () => server.close(() => done(port)));
      });
    for (let port = ${PORT_RANGE.from}; port + 1 <= ${PORT_RANGE.to}; port += 1) {
      if ((await bind(port)) !== null && (await bind(port + 1)) !== null) {
        process.stdout.write(String(port));
        process.exit(0);
      }
    }
    process.exit(1);
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30_000,
    // The probe must not see the choice of a previous run in this process's own
    // environment, because that would be inherited by the probe.
    env: { ...process.env, VIDI6_E2E_PORT: '', VIDI6_E2E_INSPECTOR: '' },
  });
  const port = Number.parseInt(run.stdout?.trim() ?? '', 10);
  if (!Number.isInteger(port) || port < PORT_RANGE.from || port + 1 > PORT_RANGE.to) {
    console.log(`[playwright] every port in ${PORT_RANGE.from}-${PORT_RANGE.to} is taken; using ${fallback.e2e}`);
    process.env.VIDI6_E2E_PORT = String(fallback.e2e);
    process.env.VIDI6_E2E_INSPECTOR = String(fallback.inspector);
    return fallback;
  }
  if (port !== PORT_RANGE.from) {
    console.log(
      `[playwright] ${PORT_RANGE.from} is held by a server from an earlier run (it serves the bundle it read at ` +
        `startup, not this one): using ${port} and ${port + 1} instead, both inside the allocated range`,
    );
  }
  const pair = { e2e: port, inspector: port + 1 };
  process.env.VIDI6_E2E_PORT = String(pair.e2e);
  process.env.VIDI6_E2E_INSPECTOR = String(pair.inspector);
  return pair;
}

const PORTS = pickPorts();
const PORT_E2E = PORTS.e2e;
const PORT_INSPECTOR = PORTS.inspector;
const BASE_URL = `http://127.0.0.1:${PORT_E2E}`;
const VIEWPORT = { width: 1280, height: 800 };

const FIREFOX_PROBE_CACHE = resolve('.ua/firefox-launch.json');
const FIREFOX_PROBE_TIMEOUT_MS = 120_000;

interface ProbeCache {
  playwright: string;
  platform: string;
  firefoxStarts: boolean;
}

/**
 * The story asks for the board to work in Chromium, Firefox and WebKit, so all three
 * projects are configured. Firefox, though, does not start in every environment: in
 * some sandboxes its main process aborts before the automation pipe opens (see
 * NOTES.md), which has nothing to do with the board. To keep that from being reported
 * as a broken board, the runner is probed once, the answer is cached per Playwright
 * version, and the Firefox project is only added when the browser actually starts.
 *
 * `VIDI6_FIREFOX=1` forces the project on (it then fails loudly if Firefox is broken),
 * `VIDI6_FIREFOX=0` skips it.
 */
function firefoxStarts(): boolean {
  const override = process.env.VIDI6_FIREFOX;
  if (override === '0') {
    console.log('[playwright] firefox project skipped (VIDI6_FIREFOX=0)');
    return false;
  }
  if (override === '1') {
    console.log('[playwright] firefox project forced on (VIDI6_FIREFOX=1)');
    return true;
  }

  const cache = readProbeCache();
  if (cache) return cache.firefoxStarts;

  const starts = probeFirefox();
  writeProbeCache(starts);
  console.log(
    starts
      ? '[playwright] firefox launches here: running the firefox project'
      : '[playwright] firefox does not launch in this environment (its process aborts at startup, see NOTES.md): ' +
          'the firefox project is skipped and the board is checked in chromium and webkit instead. ' +
          'Set VIDI6_FIREFOX=1 to run it anyway.',
  );
  return starts;
}

/** Launches Firefox in a throwaway child process; true when it comes up. */
function probeFirefox(): boolean {
  const probe = `
    import('playwright').then(
      async ({ firefox }) => {
        const browser = await firefox.launch({ timeout: ${FIREFOX_PROBE_TIMEOUT_MS} });
        await browser.close();
        process.exit(0);
      },
      () => process.exit(1),
    );
  `;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8',
    timeout: FIREFOX_PROBE_TIMEOUT_MS + 30_000,
    env: process.env,
  });
  return run.status === 0;
}

function readProbeCache(): ProbeCache | null {
  try {
    const cached = JSON.parse(readFileSync(FIREFOX_PROBE_CACHE, 'utf8')) as ProbeCache;
    return cached.playwright === playwrightVersion() && cached.platform === process.platform
      ? cached
      : null;
  } catch {
    return null;
  }
}

function writeProbeCache(firefoxStarts: boolean): void {
  try {
    mkdirSync(dirname(FIREFOX_PROBE_CACHE), { recursive: true });
    const cache: ProbeCache = {
      playwright: playwrightVersion(),
      platform: process.platform,
      firefoxStarts,
    };
    writeFileSync(FIREFOX_PROBE_CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // The cache is a convenience; a probe is re-run next time if it cannot be written.
  }
}

/** The Playwright version the cache is keyed on, read without `require` (ESM config). */
function playwrightVersion(): string {
  const manifest = JSON.parse(
    readFileSync(resolve('node_modules/@playwright/test/package.json'), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

const FIREFOX_STARTS = firefoxStarts();

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'off',
    video: 'off',
    // A click that cannot happen is a failure, not something to wait for: Playwright's
    // default is to wait forever, which turns a disabled button into a run that stops
    // answering. Twenty seconds is longer than any action here takes to become possible.
    actionTimeout: 20_000,
  },
  projects: [
    // The story 1 to 3 tests, against the runtime this configuration starts below: one
    // server for the whole run, because a board that several people edit together needs a
    // server that stays up while they do it.
    {
      name: 'chromium',
      grepInvert: /@persist/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
    ...(FIREFOX_STARTS
      ? [{ name: 'firefox', grepInvert: /@persist/, use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } }]
      : []),
    { name: 'webkit', grepInvert: /@persist/, use: { ...devices['Desktop WebKit'], viewport: VIEWPORT } },
    // The persistence tests (story 4) start and stop their own runtime instead, because what
    // they assert is a board surviving a process that does not: a server that is alive for
    // the whole run cannot show that. They are Chromium only — the claim is about storage and
    // about a page reopening, and three browsers of the same restart is three timings, not
    // three answers. `@persist` is what keeps them out of the projects above, whose server
    // would answer them from a directory they do not own.
    { name: 'persistence', grep: /@persist/, use: { ...devices['Desktop Chrome'], viewport: VIEWPORT } },
    // The two long checks (TC-29 idle, TC-30 soak) live in the nightly project. It runs
    // Chromium only — that is the browser the story has to work in, and three copies of a
    // ten-minute run buys time, not coverage — and `npm run test:e2e` filters these tests
    // out by tag while `npm run test:e2e:nightly` selects nothing else.
    {
      name: 'nightly',
      grep: /@nightly/,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
  webServer: {
    // Static assets are served by `wrangler dev` from dist/client, the same path
    // later stories will use. The bundle is built in "test" mode by the `test:e2e`
    // script before Playwright starts, so the camera fixture window.__vidi6 exists
    // (see design Fixtures) and so this command is wrangler itself: wrapped in
    // `npm run`, Playwright's shutdown leaves the runtime behind holding these ports.
    //
    // `--var TEST_HOOKS:1` mounts the room's outside-facing test routes on this runtime, for the
    // tests that need a board with a history they cannot make by clicking (a legacy board, with
    // notes in its log and no created row). It is given here and never written into wrangler.jsonc,
    // for the same reason the client build is asked for in test mode: it belongs to the test run and
    // not to the thing that gets deployed.
    command: `npx --no-install wrangler dev --ip 127.0.0.1 --port ${PORT_E2E} --inspector-port ${PORT_INSPECTOR} --var TEST_HOOKS:1`,
    url: BASE_URL,
    timeout: 300_000,
    // Only reused when something already answers on the e2e port: the assets are read
    // off disk at startup, so a server started before this run's build would serve an
    // older bundle. The port is picked because it is free, so normally nothing is there.
    // `openBoard` checks for the test build before anything else.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
