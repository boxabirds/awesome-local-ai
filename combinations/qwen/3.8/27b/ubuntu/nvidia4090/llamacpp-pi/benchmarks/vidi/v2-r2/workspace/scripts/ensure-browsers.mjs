/**
 * Runs the e2e suite with a working Chromium, regardless of how
 * PLAYWRIGHT_BROWSERS_PATH is set (or unset) in the environment.
 *
 * The sandbox pre-installs Playwright browsers in a dedicated cache
 * (e.g. ~/.cache/vidi-agent-ms-playwright) while the environment may point
 * PLAYWRIGHT_BROWSERS_PATH elsewhere; pick the first candidate directory
 * that actually contains a chromium binary.
 *
 * Usage: npm run test:e2e [extra playwright args]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function hasChromium(dir) {
  try {
    return readdirSync(dir).some(
      (name) =>
        name.startsWith('chromium') &&
        (existsSync(path.join(dir, name, 'chrome-linux64', 'chrome')) ||
          existsSync(
            path.join(dir, name, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          )),
    );
  } catch {
    return false;
  }
}

// The sandbox pre-installs the browsers in a dedicated cache; the process
// home may be mapped elsewhere, so try the well-known absolute location too.
const candidates = [
  process.env.PLAYWRIGHT_BROWSERS_PATH,
  path.join(homedir(), '.cache', 'vidi-agent-ms-playwright'),
  '~/.cache/vidi-agent-ms-playwright',
  path.join(homedir(), '.cache', 'ms-playwright'),
].filter(Boolean);

const working = candidates.find(hasChromium);
if (working && working !== process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = working;
}

const status = spawnSync(
  'npx',
  ['playwright', 'test', '--project', 'chromium', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);
process.exit(status.status ?? 1);
