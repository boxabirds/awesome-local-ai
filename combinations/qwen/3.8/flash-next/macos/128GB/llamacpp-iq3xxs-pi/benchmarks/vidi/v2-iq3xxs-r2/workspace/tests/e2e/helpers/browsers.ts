import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export const ALL_BROWSERS: readonly BrowserName[] = ['chromium', 'firefox', 'webkit'];

/**
 * Launch each installed browser once and keep the ones that start.
 *
 * Some sandboxed/CI machines can only start Chromium: Firefox and WebKit abort in
 * process launch (`SIGABRT`) before Playwright can connect, which is an environment
 * limitation rather than a product one. Rather than failing the suite for it, the config
 * probes them and skips the missing browsers with a warning. Set `E2E_BROWSERS`
 * (`chromium`, `chromium,firefox`, or `all`) to choose explicitly and skip the probe.
 */
/** Cache file: probing means launching every browser, which no test run should pay twice. */
const CACHE_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'node_modules',
  '.cache',
  'vidi6-e2e-browsers.json',
);
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function readCache(): BrowserName[] | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as {
      browsers?: unknown;
      at?: unknown;
    };
    if (typeof parsed.at !== 'number' || Date.now() - parsed.at > CACHE_MAX_AGE_MS) return null;
    if (!Array.isArray(parsed.browsers)) return null;
    const browsers = parsed.browsers.filter((name): name is BrowserName =>
      ALL_BROWSERS.includes(name as BrowserName),
    );
    return browsers.length > 0 ? browsers : null;
  } catch {
    return null;
  }
}

function writeCache(browsers: BrowserName[]): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ browsers, at: Date.now() }));
  } catch {
    // A cache we cannot write is only a small waste of time.
  }
}

function probeInstalledBrowsers(): BrowserName[] {
  const probe = `
    const pw = require('playwright');
    (async () => {
      for (const name of ${JSON.stringify(ALL_BROWSERS)}) {
        try {
          const browser = await pw[name].launch({ timeout: 30_000 });
          await browser.close();
          console.log(name + ':ok');
        } catch {
          console.log(name + ':no');
        }
      }
    })();
  `;
  const result = spawnSync(process.execPath, ['-e', probe], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 180_000,
  });
  const available = ALL_BROWSERS.filter(
    (name) => new RegExp(`^${name}:ok$`, 'm').test(result.stdout ?? ''),
  );
  if (available.length === 0) {
    console.warn('[e2e] no browser could start; falling back to chromium');
    return ['chromium'];
  }
  const skipped = ALL_BROWSERS.filter((name) => !available.includes(name));
  if (skipped.length > 0) {
    console.warn(
      `[e2e] skipping ${skipped.join(', ')}: the browser process could not be launched on this machine. ` +
        'Run E2E_BROWSERS=all on a machine with all three installed.',
    );
  }
  return available;
}

const CACHE_KEY = 'E2E_BROWSERS_RESOLVED';

export function selectedBrowsers(): BrowserName[] {
  const requested = (process.env.E2E_BROWSERS ?? 'all')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (requested.length > 0 && !requested.includes('all')) {
    const known = requested.filter((name): name is BrowserName =>
      ALL_BROWSERS.includes(name as BrowserName),
    );
    if (known.length === 0) {
      throw new Error(`E2E_BROWSERS="${process.env.E2E_BROWSERS}" names no known browser`);
    }
    return known;
  }
  const fromEnv = (process.env[CACHE_KEY] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name): name is BrowserName => ALL_BROWSERS.includes(name as BrowserName));
  if (fromEnv.length > 0) return fromEnv;
  // Playwright evaluates the config in every worker, so share one probe result.
  const cached = readCache();
  if (cached) {
    process.env[CACHE_KEY] = cached.join(',');
    return cached;
  }
  const available = probeInstalledBrowsers();
  writeCache(available);
  process.env[CACHE_KEY] = available.join(',');
  return available;
}
