// tests/e2e/helpers/wrangler-process.ts
// Helper to start/stop `wrangler dev --persist-to` for e2e persistence tests.
// Each test gets its own process with its own persisted state directory.

import { ChildProcess, spawn } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const BASE_PORT = 8791; // Different port from the shared webServer (8787)
let portCounter = 0;

export interface WranglerProcess {
  url: string;
  stop: () => Promise<void>;
}

export async function startWranglerProcess(persistDir?: string): Promise<WranglerProcess> {
  const dir = persistDir ?? join(tmpdir(), `vidi6-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const port = BASE_PORT + portCounter++;

  const child = spawn('npx', [
    'wrangler', 'dev',
    '--port', String(port),
    '--ip', '127.0.0.1',
    '--persist-to', `file://${dir}`,
    '--var', 'TEST_HOOKS=1',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TEST_HOOKS: '1' },
  });

  const stderrParts: string[] = [];
  child.stderr?.on('data', (data: Buffer) => {
    stderrParts.push(data.toString());
  });
  child.stdout?.on('data', () => {});

  const url = `http://localhost:${port}`;

  // Wait for the server to be ready
  await waitForReady(url, 90_000, child, () => stderrParts.join(''));

  return {
    url,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        setTimeout(resolve, 5000);
      });
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

async function waitForReady(url: string, timeoutMs: number, child: ChildProcess, getStderr: () => string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status !== 0) return;
    } catch {
      // Not ready yet
    }
    // Check if process died
    if (child.exitCode !== null) {
      throw new Error(`wrangler process died with code ${child.exitCode}. stderr: ${getStderr()}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`wrangler dev did not become ready within ${timeoutMs}ms. stderr: ${getStderr()}`);
}
