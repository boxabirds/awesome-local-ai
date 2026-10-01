import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolve } from 'node:path';

export interface WranglerInstance {
  port: number;
  persistDir: string;
  stop(): Promise<void>;
}

const ROOT = resolve(__dirname, '../..');

/**
 * Start `wrangler dev` with its own persist-to directory and port.
 * Returns the instance handle for stopping.
 */
export async function startWrangler(port: number): Promise<WranglerInstance> {
  const persistDir = mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));

  const proc = spawn('npx', [
    '--no-install', 'wrangler', 'dev',
    '--config', path.join(ROOT, 'wrangler.jsonc'),
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--persist-to', persistDir,
    '--var', 'TEST_HOOKS:1',
  ], {
    cwd: ROOT,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for readiness
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) break;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return {
    port,
    persistDir,
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>(resolve2 => {
        proc.on('close', () => resolve2());
        setTimeout(() => { proc.kill('SIGKILL'); resolve2(); }, 5000);
      });
    },
  };
}

/**
 * Clean up a persist directory.
 */
export function cleanPersistDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

/**
 * Build the client in test mode.
 */
export function buildTest(): void {
  execSync('npm run build:test', { cwd: ROOT, stdio: 'pipe', env: { ...process.env, CI: '1' } });
}
