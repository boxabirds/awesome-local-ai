import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface WranglerProcess {
  readonly port: number;
  readonly url: string;
  readonly persistDir: string;
  output(): string[];
  stop(): Promise<void>;
}

export interface StartOptions {
  port: number;
  // Reuse a previous run's --persist-to directory to simulate a restart
  // where the process forgot all memory but the durable storage survived.
  persistDir?: string;
  testHooks?: boolean;
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev not ready at ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// Starts an isolated `wrangler dev` with its own --persist-to directory so a
// kill + restart exercises the real DO SQLite durability path.
export async function startWrangler(options: StartOptions): Promise<WranglerProcess> {
  const persistDir = options.persistDir ?? mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
  const args = [
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(options.port),
    '--inspector-port',
    String(options.port + 1),
    '--persist-to',
    persistDir
  ];
  if (options.testHooks === true) {
    // wrangler dev does not forward arbitrary process env vars to the
    // worker, so the test-only storage hooks are enabled via --var here.
    args.push('--var', 'TEST_HOOKS:1');
  }
  const child = spawn('npx', args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', ...(options.testHooks ? { TEST_HOOKS: '1' } : {}) }
  });

  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  try {
    await waitForHttp(`http://127.0.0.1:${options.port}/`, 180_000);
  } catch (error) {
    child.kill('SIGKILL');
    console.error(output.join(''));
    throw error;
  }

  let stopped = false;
  return {
    port: options.port,
    url: `http://127.0.0.1:${options.port}`,
    persistDir,
    output: () => output,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      // The whole process group: wrangler spawns workerd as a child.
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));
      await Promise.race([exited, timeout]);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      await exited;
    }
  };
}

export function removePersistDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
