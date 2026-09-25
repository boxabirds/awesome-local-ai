/**
 * Starts and kills a real `wrangler dev` process with its own `--persist-to` directory, so a
 * test can prove that a board survives a process that forgets everything in memory.
 *
 * The client bundle is the test-mode build in dist/client, built by the shared webServer
 * (`npm run build:test`) before any test runs.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 90_000;
const EXIT_TIMEOUT_MS = 15_000;
const POLL_MS = 250;
const HTTP_OK = 200;

export interface WranglerServer {
  readonly baseURL: string;
  readonly port: number;
  readonly persistDir: string;
  /** Starts the process (again) on the same port and storage directory; waits until it serves. */
  start(): Promise<void>;
  /** SIGKILLs the whole process group (no graceful shutdown) and waits until the port is free. */
  kill(): Promise<void>;
  /** Kills the process and deletes the storage directory. */
  dispose(): Promise<void>;
}

async function serves(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(POLL_MS * 4) });
    return res.status === HTTP_OK;
  } catch {
    return false;
  }
}

async function until(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** `port` and `inspectorPort` must be unique per concurrently running test. */
export function wranglerServer(port: number, inspectorPort: number): WranglerServer {
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  const baseURL = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = '';

  const kill = async () => {
    const proc = child;
    child = null;
    if (!proc || proc.pid === undefined) return;
    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) resolve();
      else proc.once('exit', () => resolve());
    });
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
    await exited;
    await until(async () => !(await serves(baseURL)), EXIT_TIMEOUT_MS, `port ${port} to close`);
  };

  return {
    baseURL,
    port,
    persistDir,
    async start() {
      if (child) throw new Error('already running');
      output = '';
      child = spawn(
        'npx',
        [
          'wrangler',
          'dev',
          '--ip',
          '127.0.0.1',
          '--port',
          String(port),
          '--inspector-port',
          String(inspectorPort),
          '--persist-to',
          persistDir,
          '--var',
          'TEST_HOOKS:1',
          '--show-interactive-dev-session=false',
        ],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        },
      );
      child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
      child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
      const proc = child;
      await until(
        async () => {
          if (proc.exitCode !== null) throw new Error(`wrangler dev exited early:\n${output}`);
          return serves(baseURL);
        },
        READY_TIMEOUT_MS,
        `wrangler dev on ${port}:\n${output}`,
      );
    },
    kill,
    async dispose() {
      await kill();
      rmSync(persistDir, { recursive: true, force: true });
    },
  };
}
