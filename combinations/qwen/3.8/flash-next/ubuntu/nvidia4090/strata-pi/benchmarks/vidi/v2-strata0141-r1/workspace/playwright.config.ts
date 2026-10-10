import { defineConfig } from '@playwright/test';
import { chromium, firefox, webkit } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

/**
 * E2E runs against `wrangler dev` serving the test build of the client
 * (dist/client), so the production serving path is exercised from day one.
 *
 * `npm run pretest:e2e` writes `.e2e/browser.json` listing the browsers this
 * machine can actually launch (and a fallback Chromium executable when
 * Playwright's own browsers are unavailable - see NOTES.md).
 */
const PORT = Number(process.env.VIDI6_E2E_PORT ?? 24064);
const INSPECT_PORT = Number(process.env.VIDI6_E2E_INSPECT_PORT ?? PORT + 1);

type BrowserName = 'chromium' | 'firefox' | 'webkit';

interface BrowserInfo {
  browsers: BrowserName[];
  executablePaths: Partial<Record<BrowserName, string>>;
}

function readBrowserInfo(): BrowserInfo | null {
  try {
    const raw = readFileSync('.e2e/browser.json', 'utf8');
    const parsed = JSON.parse(raw) as BrowserInfo;
    if (Array.isArray(parsed.browsers) && parsed.browsers.length > 0) {
      return { browsers: parsed.browsers, executablePaths: parsed.executablePaths ?? {} };
    }
  } catch {
    // Fall through to Playwright's own detection.
  }
  return null;
}

function installedBrowsers(): BrowserInfo {
  const info = readBrowserInfo();
  if (info) {
    return info;
  }
  const candidates: Array<[BrowserName, () => string]> = [
    ['chromium', () => chromium.executablePath()],
    ['firefox', () => firefox.executablePath()],
    ['webkit', () => webkit.executablePath()],
  ];
  const browsers: BrowserName[] = [];
  for (const [name, path] of candidates) {
    try {
      if (existsSync(path())) {
        browsers.push(name);
      }
    } catch {
      // Not available on this machine.
    }
  }
  return { browsers: browsers.length > 0 ? browsers : ['chromium'], executablePaths: {} };
}

const info = installedBrowsers();
const browsers = (process.env.VIDI6_E2E_BROWSERS ?? info.browsers.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter((name): name is BrowserName =>
    ['chromium', 'firefox', 'webkit'].includes(name),
  );

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: browsers.map((name) => ({
    name,
    use: {
      browserName: name,
      ...(info.executablePaths[name]
        ? {
            launchOptions: {
              executablePath: info.executablePaths[name],
              args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            },
          }
        : {}),
    },
  })),
  webServer: {
    // TEST_HOOKS is on here and nowhere else: the storage test hooks only ever
    // answer in a test build, and an integration test asserts they are absent
    // from a build without it.
    command:
      `npm run build:test && npx wrangler dev --ip 127.0.0.1 --port ${PORT} ` +
      `--inspector-port ${INSPECT_PORT} --show-interactive-dev-session=false --var 'TEST_HOOKS:1'`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
