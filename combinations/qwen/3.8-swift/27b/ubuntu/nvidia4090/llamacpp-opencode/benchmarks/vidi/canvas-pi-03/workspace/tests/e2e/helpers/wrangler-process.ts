/**
 * Story 4 e2e helper: start/stop a real `wrangler dev` process per test with
 * Durable Object SQLite persisted to a directory, so the process can be killed
 * and restarted (the room reloads from storage after "forgetting" memory).
 *
 * The client is built in `test` mode (so `window.__vidi6` is present) and the
 * e2e wrangler config enables the `__test` hooks (gated, never in production).
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

/**
 * Ask the OS for a free port. A fixed counter would collide with stale
 * `wrangler` processes left over from a previous (timed-out) run, and the
 * readiness probe would then connect to the *old* server on that port.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('could not determine a free port'));
      });
    });
    srv.on('error', reject);
  });
}

export interface ServerHandle {
  port: number;
  url: string;
  persistDir: string;
  /** The process' combined stdout+stderr (for diagnostics on failure). */
  getOutput: () => string;
  /** Kill the process. `persistDir` is left in place so it can be restarted. */
  stop: () => Promise<void>;
  /** Kill the process and remove the persisted storage directory. */
  dispose: () => Promise<void>;
}

/**
 * Ensure the client is built in TEST mode so `window.__vidi6` is present.
 * A production `npm run build` also writes `dist/client/index.html`, so an
 * existence check alone is not enough: always (re)build in test mode. Vite
 * caches unchanged modules, so this is fast.
 */
function ensureClientBuilt(): void {
  execSync('npm run build:test', { cwd: process.cwd(), stdio: 'inherit' });
}

async function waitForReady(port: number, proc: ChildProcess): Promise<void> {
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`wrangler dev exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`wrangler dev did not become ready on ${url}`);
}

/**
 * Start `wrangler dev --persist-to <dir>`. Pass `persistDir` to restart the
 * process against existing storage (the "kill and restart" scenario).
 * `configFile` defaults to wrangler.e2e.jsonc; TC-30 passes wrangler.test.jsonc
 * (its board-create limit equals BOARD_CREATE_LIMIT exactly).
 */
export async function startWranglerProcess(
  persistDir?: string,
  configFile = 'wrangler.e2e.jsonc',
): Promise<ServerHandle> {
  ensureClientBuilt();
  const dir = persistDir ?? mkdtempSync(join(tmpdir(), 'vidi6-e2e-'));

  // Under parallel load wrangler can fail to bind its port (findFreePort
  // releases the port before wrangler binds it) or exit early; retry the whole
  // start a few times before giving up.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown = null;
  let proc: ChildProcess | null = null;
  let port = 0;
  let output = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    port = await findFreePort();
    proc = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(port),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        dir,
        '--config',
        configFile,
        '--no-show-interactive-dev-session',
      ],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    output = '';
    proc.stdout?.on('data', (d) => (output += d));
    proc.stderr?.on('data', (d) => (output += d));
    try {
      await waitForReady(port, proc);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  if (lastError !== null || !proc || proc.exitCode !== null) {
    throw new Error(
      `failed to start wrangler dev: ${lastError}\n--- output ---\n${output}`,
    );
  }

  const stop = async () => {
    try {
      proc!.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  };
  const dispose = async () => {
    await stop();
    rmSync(dir, { recursive: true, force: true });
  };

  return {
    port,
    url: `http://localhost:${port}`,
    persistDir: dir,
    getOutput: () => output,
    stop,
    dispose,
  };
}
