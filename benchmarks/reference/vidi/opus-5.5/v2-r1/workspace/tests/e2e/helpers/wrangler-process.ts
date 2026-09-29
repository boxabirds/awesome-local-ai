// Starts and kills a real `wrangler dev` process with its own persisted state, so e2e tests can
// restart the service (memory is lost; only what was written to local storage survives).
// Serves the test build in dist/client, which the shared Playwright webServer builds first.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 90_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export interface WranglerProcess {
  readonly baseURL: string;
  readonly persistDir: string;
  /** Kills the whole process tree at once (SIGKILL: nothing gets a chance to flush). */
  kill(): Promise<void>;
  /** Starts it again on the same port and persisted state; resolves once it serves requests. */
  start(): Promise<void>;
  /** Everything the process printed (for failure messages). */
  output(): string;
}

export async function wranglerProcess(opts: { testHooks?: boolean } = {}): Promise<WranglerProcess> {
  const port = await freePort();
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  const baseURL = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let log = '';

  const kill = async () => {
    const c = child;
    child = null;
    if (!c || c.exitCode !== null || c.pid === undefined) return;
    const exited = new Promise<void>((r) => c.once('exit', () => r()));
    try {
      process.kill(-c.pid, 'SIGKILL'); // the process group: npx, wrangler and workerd
    } catch {
      c.kill('SIGKILL');
    }
    await exited;
  };

  const start = async () => {
    if (child) throw new Error('already running');
    const args = [
      'wrangler', 'dev',
      '--port', String(port),
      '--ip', '127.0.0.1',
      '--inspector-port', String(await freePort()),
      '--persist-to', persistDir,
      '--show-interactive-dev-session=false',
      ...(opts.testHooks ? ['--var', 'TEST_HOOKS:1'] : []),
    ];
    const c = spawn('npx', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
    child = c;
    c.stdout?.on('data', (d) => (log += d));
    c.stderr?.on('data', (d) => (log += d));
    const started = Date.now();
    for (;;) {
      if (c.exitCode !== null) throw new Error(`wrangler dev exited early:\n${log}`);
      try {
        const res = await fetch(`${baseURL}/`);
        if (res.ok) return;
      } catch {
        // Not listening yet.
      }
      if (Date.now() - started > READY_TIMEOUT_MS) {
        await kill();
        throw new Error(`wrangler dev not ready after ${READY_TIMEOUT_MS} ms:\n${log}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  await start();
  return { baseURL, persistDir, kill, start, output: () => log };
}
