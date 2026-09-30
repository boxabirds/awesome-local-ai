import { execSync } from 'node:child_process';

/**
 * Playwright global setup: build the client once before the specs run.
 * The worker serves `dist/client` as static assets; a stale build would
 * make the specs test the previous story's UI.
 */
export default async function globalSetup(): Promise<void> {
  execSync('npm run build', { stdio: 'inherit' });
}
