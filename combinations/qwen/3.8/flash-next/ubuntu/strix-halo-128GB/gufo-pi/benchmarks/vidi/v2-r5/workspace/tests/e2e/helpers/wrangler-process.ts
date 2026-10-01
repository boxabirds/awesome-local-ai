import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WranglerInstance {
  port: number;
  persistDir: string;
  stop(): Promise<void>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');

/**
 * Start `wrangler dev` with its own persist-to directory and port.
 * Returns the instance handle for stopping.
 */
export async function startWrangler(port: number): Promise<WranglerInstance> {
  const persistDir = mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));

  const wranglerBin = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  const proc = spawn(wranglerBin, [
    'dev',
    '--config', path.join(ROOT, 'wrangler.jsonc'),
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--persist-to', persistDir,
    '--var', 'TEST_HOOKS:1',
  ], {
    cwd: ROOT,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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
      const pid = proc.pid!;
      try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
      await new Promise<void>(resolve2 => {
        proc.on('close', () => resolve2());
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} resolve2(); }, 5000);
      });
      // Extra wait for port to be fully released
      await new Promise(r => setTimeout(r, 500));
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
