import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { get } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

export interface WranglerInstance {
  url: string;
  port: number;
  stop(): Promise<void>;
}

let nextPort = 8800;
let built = false;

function ensureBuild(): void {
  if (built) return;
  if (!existsSync('dist/client/index.html')) {
    execSync('npm run build:test', { stdio: 'inherit' });
  }
  built = true;
}

/**
 * Start a `wrangler dev` process with its own `--persist-to` directory.
 * Returns the URL to access it. The process is killed on `stop()`.
 */
export async function startWrangler(): Promise<WranglerInstance> {
  ensureBuild();
  const port = nextPort++;
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  const url = `http://127.0.0.1:${port}`;

  const proc: ChildProcess = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir, '--test-hooks', '1'],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TEST_HOOKS: '1' },
    },
  );

  // Wait for the server to be ready
  await waitForReady(url, 60_000);

  return {
    url,
    port,
    async stop(): Promise<void> {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        // Force kill after 5s
        setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 5000);
      });
      // Clean up persist directory
      try {
        rmSync(persistDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else reject(new Error(`status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Wrangler not ready after ${timeoutMs}ms at ${url}`);
}
