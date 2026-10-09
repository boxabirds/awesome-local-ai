import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LaunchOptions } from '@playwright/test';
import chromium from '@sparticuz/chromium';

// The Playwright CDN is unreachable from this sandbox, so a browser needs a
// local source (see NOTES.md):
// 1. the machine's pre-seeded build set (exact chromium-1243 for Playwright
//    1.63) is used when present;
// 2. otherwise the chromium extracted by `npm run setup:chromium` from the
//    @sparticuz/chromium npm package (already unzipped at this point:
//    executablePath() returns instantly when the extraction exists).
export const CACHED_BROWSERS = '~/.cache/vidi-agent-ms-playwright';

export function chromiumLaunchOptions(): LaunchOptions {
  if (existsSync(CACHED_BROWSERS)) {
    // Overrides the environment's PLAYWRIGHT_BROWSERS_PATH (/w/browsers),
    // which on this machine is missing the chromium build.
    process.env.PLAYWRIGHT_BROWSERS_PATH = CACHED_BROWSERS;
    return {};
  }
  const extracted = join(tmpdir(), 'chromium');
  if (existsSync(extracted)) {
    return { executablePath: extracted, args: chromium.args };
  }
  // Neither source: let Playwright report its usual "browser not installed"
  // message (run `npm run setup:chromium`).
  return {};
}
