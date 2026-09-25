import { execSync } from 'node:child_process';

/**
 * Build the test-mode client bundle once before the persist suite runs.
 * `wrangler dev` serves `dist/client`; the persist tests need the
 * `window.__vidi6` hooks that only exist in a `--mode test` build
 * (same build the main e2e config produces via its webServer command).
 */
export default async function globalSetup(): Promise<void> {
  execSync('npm run build:e2e', { stdio: 'inherit' });
}

export function teardown(): void {
  // Nothing to clean up: each test disposes its own wrangler process and
  // its persistence directory.
}
