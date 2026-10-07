// Ensure the client build exists for tests that exercise the Worker's SPA
// fallback (integration TC-06, TC-32; wrangler e2e). dist/ is gitignored and
// is normally produced by `npm run build`; this keeps `npm run test:integration`
// self-contained on a fresh checkout.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(path.join(repoRoot, 'dist', 'client', 'index.html'))) {
  execFileSync('npx', ['vite', 'build'], { cwd: repoRoot, stdio: 'inherit' });
}

export default function globalSetup() {}
