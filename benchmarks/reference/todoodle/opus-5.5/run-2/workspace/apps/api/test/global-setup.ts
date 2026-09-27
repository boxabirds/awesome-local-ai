import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The ASSETS binding serves apps/web/dist, so make sure a real build exists.
export default function setup() {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  if (existsSync(`${repo}apps/web/dist/index.html`) && !process.env.TODOODLE_REBUILD) return;
  execFileSync(`${repo}node_modules/.bin/vite`, ['build', 'apps/web', '--logLevel', 'warn'], {
    cwd: repo,
    stdio: 'inherit',
  });
}
