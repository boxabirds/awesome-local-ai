// Builds the test-mode client bundle once before the persistence suite. The
// suite starts its own `wrangler dev` processes, which serve ./dist/client as
// assets, so the bundle has to exist before any server boots.

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup(): void {
  if (process.env.VIDI6_SKIP_BUILD === '1') {
    if (!existsSync(join(process.cwd(), 'dist/client/index.html'))) {
      throw new Error('VIDI6_SKIP_BUILD=1 but dist/client/index.html does not exist');
    }
    return;
  }
  const out = execSync('npm run build:test', { encoding: 'utf8', cwd: process.cwd() });
  const stamp = statSync(join(process.cwd(), 'dist/client/index.html')).mtimeMs;
  process.env.VIDI6_CLIENT_BUILD = String(stamp);
  process.stdout.write(out.split('\n').slice(-2).join('\n') + '\n');
}
