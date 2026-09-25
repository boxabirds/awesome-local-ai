/**
 * Starts and kills a real `wrangler dev` process with on-disk state (`--persist-to`), so
 * e2e tests can prove a board survives a process that forgets everything in memory
 * (story 4 TC-19 to TC-21). Serves the test-mode client already built into dist/client
 * by the shared webServer command (`npm run build:test`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 200;
const EXIT_TIMEOUT_MS = 10_000;

export interface WranglerServer {
  readonly baseURL: string;
  readonly persistDir: string;
  /** Kills the whole process group abruptly (SIGKILL): nothing gets a chance to flush. */
  kill(): Promise<void>;
  /** Starts a new process on the same port and state directory. */
  restart(): Promise<void>;
  /** Kills the process and removes the state directory. */
  dispose(): Promise<void>;
}

async function waitReady(baseURL: string, child: ChildProcess, log: () => string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`wrangler dev exited early:\n${log()}`);
    try {
      const res = await fetch(baseURL);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`wrangler dev not ready after ${READY_TIMEOUT_MS} ms:\n${log()}`);
}

async function portFree(port: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < EXIT_TIMEOUT_MS) {
    try {
      await fetch(`http://127.0.0.1:${port}/`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  throw new Error(`port ${port} still in use`);
}

export async function startWrangler(port: number): Promise<WranglerServer> {
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  const baseURL = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let output = '';

  const launch = async () => {
    output = '';
    child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(port),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        persistDir,
        '--var',
        'TEST_HOOKS:1',
        '--show-interactive-dev-session=false',
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    await waitReady(baseURL, child, () => output);
  };

  const kill = async () => {
    const c = child as ChildProcess | null;
    child = null;
    if (c === null || c.pid === undefined) return;
    try {
      process.kill(-c.pid, 'SIGKILL'); // the whole group: npx, wrangler and workerd
    } catch {
      // already gone
    }
    await portFree(port);
  };

  await launch();
  return {
    baseURL,
    persistDir,
    kill,
    async restart() {
      await kill();
      await launch();
    },
    async dispose() {
      await kill();
      rmSync(persistDir, { recursive: true, force: true });
    },
  };
}
