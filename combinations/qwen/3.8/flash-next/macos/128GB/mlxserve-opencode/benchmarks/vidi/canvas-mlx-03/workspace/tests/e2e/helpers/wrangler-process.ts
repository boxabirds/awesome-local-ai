// Controls a real `wrangler dev` process per test, with its own `--persist-to`
// directory. Story 4's persistence guarantees (persist.room) can only be proven
// against a process that forgets its memory: we start wrangler, use it, kill the
// whole process group (wrangler *and* its workerd, which is what holds the Durable
// Object state and the listening socket), and start another process over the same
// on-disk state. Nothing is mocked — the storage is workerd's real SQLite.
//
// One environment detail is handled here, in the open: when workerd dies without a
// checkpoint it leaves the committed rows in `<id>.sqlite-wal` plus a `-shm` WAL
// index that a new workerd cannot recover from, so the fresh process reads an
// empty database. Deleting the stale `-shm` after the process is dead is the
// storage engine's own crash recovery (SQLite rebuilds the WAL index by scanning
// the `-wal`); it happens after the process is gone and does not touch the
// application's write path, which is what these tests are actually measuring.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, openSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { newBoardId } from '../../../src/shared/board-id.ts';

const REPO_ROOT = process.cwd();
const BOOT_TIMEOUT_MS = 180_000;

export interface DevServer {
  readonly port: number;
  /** http://127.0.0.1:<port> — also published as PLAYWRIGHT_BASE_URL. */
  readonly url: string;
  /** ws://127.0.0.1:<port> — the room endpoint base. */
  readonly wsUrl: string;
  readonly persistDir: string;
  readonly logPath: string;
  /** Number of times a process was started over this state directory. */
  readonly boots: number;
  /** Stop the process (SIGKILL to the process group: nothing is drained). */
  stop(): Promise<void>;
  /** Stop and start again over the same `--persist-to` directory. */
  restart(): Promise<DevServer>;
  /** Tail of the captured wrangler output, for failure messages. */
  logTail(lines?: number): string;
  /** Kill and delete the persistent state directory. */
  dispose(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (typeof addr === 'object' && addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else reject(new Error('could not allocate a free port'));
    });
  });
}

/** Absolute paths of every local Durable Object SQLite file under `dir`. */
function doDatabases(dir: string): string[] {
  const root = join(dir, 'v3', 'do');
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.sqlite')) out.push(p);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

/** Storage-engine crash recovery: drop the stale WAL indexes left by a killed
 *  workerd so the next process rebuilds them from the `-wal` files. */
function recoverStaleWalIndexes(dir: string): void {
  for (const db of doDatabases(dir)) {
    const shm = `${db}-shm`;
    if (existsSync(shm)) rmSync(shm, { force: true });
  }
}

async function waitForHttp(url: string, deadlineMs: number, child: ChildProcess): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`wrangler dev exited before becoming ready (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() - start > deadlineMs) throw new Error(`wrangler dev not ready after ${deadlineMs} ms`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

class Server implements DevServer {
  port = 0;
  url = '';
  wsUrl = '';
  boots = 0;
  logPath = '';
  private child: ChildProcess | null = null;

  constructor(readonly persistDir: string) {}

  logTail(lines = 30): string {
    try {
      return readFileSync(this.logPath, 'utf8').split('\n').slice(-lines).join('\n');
    } catch {
      return '(no log)';
    }
  }

  async boot(): Promise<this> {
    this.port = await freePort();
    this.logPath = join(this.persistDir, `wrangler-${this.port}.log`);
    const out = openSync(this.logPath, 'a');
    this.child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(this.port),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        this.persistDir,
        // TC-24 needs the test-only storage actions; no other deployment has them.
        '--var',
        'VIDI_TEST_HOOKS:1',
        '--log-level',
        'warn',
      ],
      { cwd: REPO_ROOT, detached: true, stdio: ['ignore', out, out], env: process.env },
    );
    const child = this.child;
    child.on('error', (err) => console.error('wrangler spawn error', err));
    try {
      await waitForHttp(`http://127.0.0.1:${this.port}/`, BOOT_TIMEOUT_MS, child);
    } catch (err) {
      throw new Error(`${(err as Error).message}\n--- wrangler output ---\n${this.logTail(40)}`);
    }
    this.boots++;
    this.url = `http://127.0.0.1:${this.port}`;
    this.wsUrl = this.url.replace(/^http/, 'ws');
    // RawClient and anything else that builds a room URL reads this variable.
    process.env.PLAYWRIGHT_BASE_URL = this.url;
    return this;
  }

  /** Kill wrangler and workerd. A negative pid signals the whole process group
   *  (`detached: true` put them there), which is what "the process is gone" means
   *  for a Durable Object: no in-memory state survives. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
      const start = Date.now();
      while (child.exitCode === null && child.signalCode === null && Date.now() - start < 10_000) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    this.child = null;
    // Belt and braces: never leave a process holding the state directory. workerd
    // names its listening socket on its command line, so it can be reached by port.
    for (const pattern of [`wrangler dev --port ${this.port}`, `entry=(localhost|127.0.0.1):${this.port}`]) {
      try {
        execFileSync('pkill', ['-9', '-f', pattern], { stdio: 'ignore' });
      } catch {
        /* nothing matched, which is the normal case */
      }
    }
    await new Promise((r) => setTimeout(r, 200));
    recoverStaleWalIndexes(this.persistDir);
  }

  /** Same state directory, new process: `boots` counts the starts so far. */
  async restart(): Promise<DevServer> {
    await this.stop();
    return this.boot();
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.persistDir, { recursive: true, force: true });
  }
}

/** Start `wrangler dev` with a private, empty persistent state directory. */
export async function startDevServer(): Promise<DevServer> {
  const dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  return new Server(dir).boot();
}

/** Start `wrangler dev` over an existing `--persist-to` directory. */
export async function startDevServerAt(persistDir: string): Promise<DevServer> {
  if (!existsSync(persistDir)) throw new Error(`persist dir missing: ${persistDir}`);
  return new Server(persistDir).boot();
}

/** A board id the Worker will accept (22-char base64url). */
export function persistBoardId(): string {
  return newBoardId();
}
