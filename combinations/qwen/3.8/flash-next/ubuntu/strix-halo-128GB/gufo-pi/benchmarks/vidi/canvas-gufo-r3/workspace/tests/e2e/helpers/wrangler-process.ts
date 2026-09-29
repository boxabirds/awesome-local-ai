/**
 * Manage a wrangler dev process with persistent DO storage.
 * Used by TC-19/TC-20/TC-21 which need to kill and restart the server
 * while preserving SQLite storage on disk.
 */
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';

export interface WranglerProcess {
  port: number;
  persistDir: string;
  url: string;
  kill(): Promise<void>;
}

function isPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(`http://localhost:${port}/`, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function waitForReady(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortReady(port)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server on port ${port} did not become ready within ${timeoutMs}ms`);
}

/**
 * Start a wrangler dev process on a given port with persistent storage.
 * Resolves when the server is ready to accept connections.
 */
export async function startWrangler(port: number, extraArgs: string[] = []): Promise<WranglerProcess> {
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));

  const args = [
    'dev',
    '--port', String(port),
    '--persist-to', persistDir,
    '--var', 'TEST_HOOKS:1',
    ...extraArgs,
  ];

  const child = spawn('npx', ['wrangler', ...args], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_LOG: 'error' },
  });

  // Collect stderr for debugging
  let stderrOutput = '';
  child.stderr?.on('data', (d: Buffer) => { stderrOutput += d.toString(); });

  await waitForReady(port);

  return {
    port,
    persistDir,
    url: `http://localhost:${port}`,
    async kill() {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.on('exit', () => resolve());
        setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
      });
    },
  };
}

/** Clean up a wrangler process and its temp directory. */
export async function cleanupWrangler(wp: WranglerProcess): Promise<void> {
  await wp.kill();
  try {
    rmSync(wp.persistDir, { recursive: true, force: true });
  } catch { /* best effort */ }
}
