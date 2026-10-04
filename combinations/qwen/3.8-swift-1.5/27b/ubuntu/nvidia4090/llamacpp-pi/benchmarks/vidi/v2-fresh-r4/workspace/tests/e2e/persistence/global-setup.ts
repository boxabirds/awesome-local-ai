/**
 * Global setup for the persistence E2E suite: produces the test-mode client
 * build (window.__vidi6 hook) that `wrangler dev` serves from dist/client.
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  execSync('npm run build:e2e', { stdio: 'inherit', cwd: process.cwd() });
}
