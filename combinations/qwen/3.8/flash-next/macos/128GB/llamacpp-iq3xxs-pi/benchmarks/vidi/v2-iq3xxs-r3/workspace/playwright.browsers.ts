import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { devices, type Config, type Project } from '@playwright/test';

/**
 * The browser selection and the `wrangler dev` server, shared by the two
 * Playwright configs: `playwright.config.ts` (every test that is not @nightly)
 * and `playwright.nightly.config.ts` (only the long ones). They need different
 * ports so the two never fight over `wrangler dev`, and never more than one at
 * a time on this machine.
 */
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
    if (unknown.length > 0) {
      throw new Error(`E2E_BROWSERS contains unknown browsers: ${unknown.join(', ')}`);
    }
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
      .map(
        (name) => `${name}: ${probe.find((entry) => entry.name === name)?.error ?? 'cannot launch'}`,
      )
      .join('; ');
    console.warn(`[e2e] WARNING skipping ${skipped.join(', ')} — cannot launch here (${detail})`);
  }
  return available.length > 0 ? available : ['chromium'];
}

export interface ServeOptions {
  /** Where the Worker (and the client build) is served. */
  port: number;
  /** `wrangler dev`'s inspector port; also has to be inside the allocated range. */
  inspectorPort: number;
}

/** The config a suite needs against this repo: one `wrangler dev`, real build. */
export function suite(options: ServeOptions): Pick<Config, 'use' | 'projects' | 'webServer'> {
  const baseUrl = `http://127.0.0.1:${options.port}`;
  return {
    use: {
      baseURL: baseUrl,
      viewport: VIEWPORT,
      trace: 'off',
      video: 'off',
    },
    projects: browsersToRun().map<Project>((name) => ({
      name,
      use: { ...devices[DEVICE[name]], viewport: VIEWPORT },
    })),
    webServer: {
      command:
        `npm exec -- wrangler dev --port ${options.port} --ip 127.0.0.1` +
        ` --inspector-port ${options.inspectorPort}`,
      url: baseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
    },
  };
}
