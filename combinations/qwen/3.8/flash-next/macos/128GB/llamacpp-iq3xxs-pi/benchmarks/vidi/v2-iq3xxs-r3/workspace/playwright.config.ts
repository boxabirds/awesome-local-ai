import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against `wrangler dev` serving the static client build, so the same
 * serving path is used from day one. All ports must sit inside the range
 * allocated to this agent ($AGENT_PORT_FIRST..$AGENT_PORT_LAST).
 */
const PORT = Number(process.env.E2E_PORT ?? 28400);
const INSPECTOR_PORT = Number(process.env.E2E_INSPECTOR_PORT ?? 28401);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

const ALL_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
type BrowserName = (typeof ALL_BROWSERS)[number];

const DEVICE: Record<BrowserName, string> = {
  chromium: 'Desktop Chrome',
  firefox: 'Desktop Firefox',
  webkit: 'Desktop Safari',
};

interface ProbeEntry {
  readonly name: string;
  readonly ok: boolean;
  readonly error?: string;
}

// Playwright evaluates this config once per worker; the probe costs a few
// seconds, so the answer is cached for the duration of a test run.
const PROBE_CACHE = 'node_modules/.cache/vidi6/e2e-browser-probe.json';
const PROBE_TTL_MS = 15 * 60_000;

function readCachedProbe(): ProbeEntry[] | undefined {
  try {
    const raw = readFileSync(PROBE_CACHE, 'utf8');
    const cached = JSON.parse(raw) as { at: number; report: ProbeEntry[] };
    if (Date.now() - cached.at < PROBE_TTL_MS) return cached.report;
  } catch {
    // no cache yet
  }
  return undefined;
}

function runProbe(): ProbeEntry[] {
  const output = execFileSync(process.execPath, ['scripts/probe-browsers.mjs'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const report = JSON.parse(output.trim().split('\n').at(-1) ?? '[]') as ProbeEntry[];
  try {
    mkdirSync(dirname(PROBE_CACHE), { recursive: true });
    writeFileSync(PROBE_CACHE, JSON.stringify({ at: Date.now(), report }));
  } catch {
    // caching is optional
  }
  return report;
}

/**
 * Browsers to run: `E2E_BROWSERS=chromium,firefox` wins, otherwise ask the
 * probe which browsers actually start on this machine. A browser that cannot
 * launch would abort the whole suite instead of reporting anything, so it is
 * skipped with a warning instead (see NOTES.md).
 */
function browsersToRun(): BrowserName[] {
  const requested = (process.env.E2E_BROWSERS ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (requested.length > 0) {
    const unknown = requested.filter((name) => !ALL_BROWSERS.includes(name as BrowserName));
    if (unknown.length > 0) throw new Error(`E2E_BROWSERS contains unknown browsers: ${unknown.join(', ')}`);
    return requested as BrowserName[];
  }

  let probe: ProbeEntry[];
  try {
    probe = readCachedProbe() ?? runProbe();
  } catch (error) {
    console.warn(`[e2e] browser probe failed (${error}); trying all browsers`);
    return [...ALL_BROWSERS];
  }

  const available = ALL_BROWSERS.filter((name) => probe.find((entry) => entry.name === name)?.ok);
  const skipped = ALL_BROWSERS.filter((name) => !available.includes(name));
  if (skipped.length > 0) {
    const detail = skipped
      .map((name) => `${name}: ${probe.find((entry) => entry.name === name)?.error ?? 'cannot launch'}`)
      .join('; ');
    console.warn(`[e2e] WARNING skipping ${skipped.join(', ')} — cannot launch here (${detail})`);
  }
  return available.length > 0 ? available : ['chromium'];
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    trace: 'off',
    video: 'off',
  },
  projects: browsersToRun().map((name) => ({
    name,
    use: { ...devices[DEVICE[name]], viewport: VIEWPORT },
  })),
  webServer: {
    command: `npm exec -- wrangler dev --port ${PORT} --ip 127.0.0.1 --inspector-port ${INSPECTOR_PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
});
