// A `wrangler dev` that the test owns, so it can be stopped and started again
// against the SAME Durable Object persistence directory. That is the only way to
// assert "the board comes back from storage" as the user experiences it: the
// process holding the Durable Object in memory has to actually go away.
//
// It runs with --var TEST_HOOKS:1, which is what maps /__test/... onto the
// room's failure-injection methods; production configuration never sets it.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ManagedWorker {
  readonly origin: string;
  readonly persistDir: string;
  /** Stop the process. The persistence directory stays. */
  stop(): Promise<void>;
  /** Start again with the same persistence directory (what a deploy restart is). */
  restart(): Promise<void>;
  /** Stop and delete the persistence directory. Always call this. */
  dispose(): Promise<void>;
  /** Last lines of the worker's own output, for a useful failure message. */
  logs(): string;
}

const ROOT = process.cwd(); // playwright runs from the repository root
const READY_TIMEOUT_MS = 180_000;

async function reachable(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/`, { signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitForReady(origin: string, log: () => string): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await reachable(origin)) return;
    if (Date.now() - start > READY_TIMEOUT_MS) {
      throw new Error(`worker at ${origin} never became ready\n${log()}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function waitForDown(origin: string): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (!(await reachable(origin))) return;
    if (Date.now() - start > 20_000) throw new Error(`worker at ${origin} would not stop`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startWorker(port: number, persistTo?: string): Promise<ManagedWorker> {
  const persistDir = persistTo ?? mkdtempSync(join(tmpdir(), 'vidi6-durable-'));
  const origin = `http://127.0.0.1:${port}`;
  const tail: string[] = [];
  let child: ChildProcess | null = null;

  const log = () => tail.slice(-60).join('\n');

  const spawnOnce = async (): Promise<void> => {
    child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--persist-to',
        persistDir,
        '--var',
        'TEST_HOOKS:1',
      ],
      { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const collect = (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        tail.push(line);
        if (tail.length > 400) tail.shift();
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    await waitForReady(origin, log);
  };

  const kill = async (): Promise<void> => {
    const proc = child;
    child = null;
    if (!proc || proc.killed || proc.pid === undefined) return;
    try {
      // The whole process group: wrangler spawns a workerd child of its own.
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    await waitForDown(origin);
  };

  await spawnOnce();

  return {
    origin,
    persistDir,
    stop: kill,
    restart: async () => {
      await kill();
      await spawnOnce();
    },
    dispose: async () => {
      await kill();
      try {
        rmSync(persistDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
    logs: log,
  };
}
