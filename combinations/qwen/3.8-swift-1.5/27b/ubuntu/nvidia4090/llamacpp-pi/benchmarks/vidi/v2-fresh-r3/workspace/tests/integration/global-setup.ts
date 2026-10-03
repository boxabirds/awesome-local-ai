/**
 * Global setup: starts a `wrangler dev` server for integration tests.
 */
import { execSync, spawn, type ChildProcess } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

declare const process: { env: Record<string, string | undefined>; cwd(): string };

const PORT = process.env.INTEGRATION_PORT || '23030';
let serverProcess: ChildProcess | null = null;

export async function setup() {
  // Build the client first
  execSync('npm run build', { stdio: 'pipe', cwd: process.cwd() });

  // Start wrangler dev
  serverProcess = spawn('npx', ['wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1'], {
    stdio: 'pipe',
    env: { ...process.env },
    cwd: process.cwd(),
  });

  // Wait for the server to be ready
  const startTime = Date.now();
  const timeout = 30000;
  while (Date.now() - startTime < timeout) {
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/`);
      if (resp.status === 200) return;
    } catch {
      // Server not ready yet
    }
    await delay(500);
  }
  throw new Error(`Server did not start on port ${PORT} within 30s`);
}

export async function teardown() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    await delay(1000);
    serverProcess = null;
  }
}
