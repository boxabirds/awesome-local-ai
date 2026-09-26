import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Build the SPA so the real ASSETS binding serves apps/web/dist (no asset mocks).
export default function setup() {
  const root = path.resolve(import.meta.dirname, '../../..');
  execFileSync(path.join(root, 'node_modules/.bin/vite'), ['build', '--logLevel', 'error'], {
    cwd: path.join(root, 'apps/web'),
    stdio: 'inherit',
  });
}
