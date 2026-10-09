/**
 * Global setup for the persistence e2e project: build the `test`-mode client
 * once (each test's wrangler process serves dist/client). The shared
 * playwright.config.ts does the same via its webServer command.
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  execSync('npm run build:client:test', { stdio: 'inherit', cwd: process.cwd() });
}
