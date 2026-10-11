import { execSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, defineConfig, devices, firefox, webkit } from '@playwright/test';

/** Ports must come from the allocated range on this machine. */
const E2E_PORT = Number(process.env.VIDI6_E2E_PORT ?? 20368);
const INSPECTOR_PORT = Number(process.env.VIDI6_INSPECTOR_PORT ?? 20369);
const VIEWPORT = { width: 1280, height: 800 };

type BrowserWithPath = { executablePath(): string };

function hasBinary(browser: BrowserWithPath): boolean {
  try {
    return existsSync(browser.executablePath());
  } catch {
    return false;
  }
}

/**
 * True when every shared library the binary needs is present on this host.
 * Playwright's own builds ship private libraries (webkit keeps them in a
 * sys/lib folder next to the main library), so `ldd` is run with those
 * directories on `LD_LIBRARY_PATH` — otherwise a perfectly runnable browser
 * looks missing.
 */
function librariesResolve(binary: string, extraLibraryDirs: readonly string[] = []): boolean {
  try {
    const libraryPath = [...extraLibraryDirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    const out = execSync(`ldd ${JSON.stringify(binary)} 2>/dev/null`, {
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: libraryPath },
    });
    return !out.includes('not found');
  } catch {
    // No `ldd` available: assume the host is fine and let Playwright report it.
    return true;
  }
}

/**
 * Chromium is the primary target. If the exact build Playwright wants is not
 * installed, fall back to any Chrome for Testing build already on the machine.
 */
function chromiumExecutable(): string | undefined {
  if (process.env.VIDI6_CHROMIUM_PATH && existsSync(process.env.VIDI6_CHROMIUM_PATH)) {
    return process.env.VIDI6_CHROMIUM_PATH;
  }

  try {
    const preferred = chromium.executablePath();
    if (existsSync(preferred)) {
      return preferred;
    }
  } catch {
    // Not installed at the expected revision; keep looking.
  }

  const homes = [
    process.env.HOME,
    os.homedir(),
    (() => {
      try {
        return os.userInfo().homedir;
      } catch {
        return undefined;
      }
    })(),
  ].filter((home, index, all): home is string => typeof home === 'string' && all.indexOf(home) === index);

  const roots = [
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? [process.env.PLAYWRIGHT_BROWSERS_PATH] : []),
    ...homes.flatMap((home) => [
      path.join(home, '.cache', 'ms-playwright'),
      path.join(home, '.cache', 'vidi-agent-ms-playwright'),
    ]),
  ];

  for (const root of roots) {
    const matches = globSync(path.join(root, 'chromium-*', 'chrome-linux64', 'chrome')).sort().reverse();
    const usable = matches.find((candidate) => librariesResolve(candidate));
    if (usable) {
      return usable;
    }
  }
  return undefined;
}

/** WebKit needs host libraries (libavif, libsoup, libjxl) that may be missing. */
function webkitRunsOnThisHost(): boolean {
  if (!hasBinary(webkit)) {
    return false;
  }
  const webkitRoot = path.dirname(webkit.executablePath());
  const bundles = [
    { name: 'minibrowser-wpe', library: 'libWPEWebKit-2.0.so.1' },
    { name: 'minibrowser-gtk', library: 'libwebkitgtk-6.0.so.4' },
  ].map((bundle) => {
    const lib = path.join(webkitRoot, bundle.name, 'lib');
    return { library: path.join(lib, bundle.library), search: [lib, path.join(webkitRoot, bundle.name, 'sys', 'lib')] };
  });
  const candidates = bundles.filter((bundle) => existsSync(bundle.library));
  return (
    candidates.length === 0 ||
    candidates.some((candidate) => librariesResolve(candidate.library, candidate.search))
  );
}

const chromiumPath = chromiumExecutable();

const projects = [
  {
    name: 'chromium',
    enabled: chromiumPath !== undefined && librariesResolve(chromiumPath),
    use: {
      ...devices['Desktop Chrome'],
      viewport: VIEWPORT,
      launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
    },
  },
  {
    name: 'firefox',
    enabled: hasBinary(firefox) && librariesResolve(firefox.executablePath()),
    use: { ...devices['Desktop Firefox'], viewport: VIEWPORT },
  },
  {
    name: 'webkit',
    enabled: webkitRunsOnThisHost(),
    use: { ...devices['Desktop Safari'], viewport: VIEWPORT },
  },
].filter((project) => project.enabled);

if (projects.length === 0) {
  throw new Error(
    'No usable browser for e2e. Install one with `npx playwright install chromium` (or firefox/webkit).',
  );
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // The built client is served by `wrangler dev`, the same path production uses.
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    viewport: VIEWPORT,
  },
  webServer: {
    command: `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${E2E_PORT} --inspector-port ${INSPECTOR_PORT} --show-interactive-dev-session=false --log-level warn`,
    port: E2E_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
  projects,
});
