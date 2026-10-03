// A real `wrangler dev` process that e2e tests own outright: spawn it, wait until
// it serves, stop it, and start another against the SAME `--persist-to` directory
// to prove a board survives a process that forgets everything in memory.
//
// Story 4's persistence guarantees are already proven against real Durable Object
// SQLite in the integration suite (a woken object reloads from disk). What only a
// real process restart proves is that the data on disk — not some in-memory cache —
// is what a board is rebuilt from. This helper drives that lifecycle.
//
// Each phase gets its OWN app and inspector port (so a socket lingering from the
// stopped phase can never collide with the next), but phases that must share data
// share one `--persist-to` directory and never run at the same time: two `wrangler
// dev` processes on one state directory make workerd die with SQLITE_BUSY.

import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';

const ROOT = process.cwd();
const WRANGLER_BIN = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/** A fresh, empty state directory for one test's board. */
export function newPersistDir(): string {
  const base = path.join(ROOT, 'node_modules', '.tmp', 'e2e-persist');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, 'state-'));
}

export function dropPersistDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort; a leaked temp dir is harmless.
  }
}

export interface WranglerOptions {
  /** HTTP port the board is served on. */
  port: number;
  /** Chrome DevTools port (must differ per live process). */
  inspectorPort: number;
  /** The `--persist-to` state directory; pass the same one across a restart. */
  dir: string;
  /**
   * Extra Worker vars passed with `--var KEY:VALUE` (e.g. `TEST_HOOKS: '1'`). Set
   * only on the command line, so they never appear in a production `wrangler.jsonc`.
   */
  vars?: Record<string, string>;
}

/** One running `wrangler dev`, with the base URL its board pages live under. */
export class WranglerProc {
  readonly baseURL: string;
  private proc: ChildProcess | null = null;
  private stopped = Promise.resolve();

  constructor(private readonly opts: WranglerOptions) {
    this.baseURL = `http://127.0.0.1:${opts.port}`;
  }

  /** Spawn wrangler and resolve once it answers a request with HTTP 200. */
  async start(readyTimeoutMs = 120_000): Promise<this> {
    const { port, inspectorPort, dir, vars } = this.opts;
    const varArgs: string[] = [];
    for (const [key, value] of Object.entries(vars ?? {})) {
      varArgs.push('--var', `${key}:${value}`);
    }
    const child = spawn(
      process.execPath,
      [
        WRANGLER_BIN,
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--inspector-port',
        String(inspectorPort),
        '--persist-to',
        dir,
        '--local',
        ...varArgs,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group, so stopping it takes the whole tree down: the
        // `wrangler` wrapper spawns `cli.js`, which spawns `workerd`. A signal to
        // only the wrapper orphans `workerd`, which keeps the `--persist-to` SQLite
        // locked and makes the next process on the same directory die with SQLITE_BUSY.
        detached: true,
      },
    );
    // Keep the pipes drained so wrangler never blocks on a full buffer, and retain a
    // short tail so a startup failure can report what wrangler actually said.
    const tail: string[] = [];
    const remember = (chunk: Buffer) => {
      const text = chunk.toString();
      if (process.env.VIDIO_DEBUG) process.stderr.write(text);
      for (const line of text.split('\n')) {
        if (line.trim()) {
          tail.push(line);
          if (tail.length > 40) tail.shift();
        }
      }
    };
    child.stdout.on('data', remember);
    child.stderr.on('data', remember);
    this.proc = child;

    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      try {
        const response = await fetch(`${this.baseURL}/`, { cache: 'no-store' });
        if (response.status === 200) return this;
      } catch {
        // Not listening yet.
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `wrangler dev exited before becoming ready (${this.baseURL})\n` +
            `exit code=${child.exitCode} signal=${child.signalCode}\n` +
            `last wrangler output:\n${tail.join('\n')}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`wrangler dev did not become ready on ${this.baseURL}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  /**
   * Stop this process and wait until it is truly gone — its whole process group
   * killed and its app port no longer listening — so the `--persist-to` SQLite is
   * flushed and unlocked before another process opens the same directory. The
   * wrapper's `exit` is not enough on its own: a SIGTERM to the wrapper alone can
   * orphan `workerd`, which keeps the state directory locked.
   */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    this.stopped = (async () => {
      const killTree = (signal: NodeJS.Signals) => {
        try {
          // Negative pid signals the whole process group (we started it detached).
          if (proc.pid) process.kill(-proc.pid, signal);
        } catch {
          // Already gone (ESRCH): nothing to do.
        }
      };
      killTree('SIGTERM');
      const exited = await Promise.race([
        once(proc, 'exit').then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
      ]);
      if (!exited) {
        killTree('SIGKILL');
        await Promise.race([
          once(proc, 'exit'),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
      // Sweep any straggler still in the group (an orphaned workerd), then wait for
      // the port to stop answering so the next process can safely bind and the
      // persisted SQLite handle is released.
      killTree('SIGKILL');
      await this.waitForPortFree(15_000);
    })();
    await this.stopped;
  }

  /** Wait until nothing is listening on this proc's app port any more. */
  private waitForPortFree(timeoutMs: number): Promise<void> {
    const { port } = this.opts;
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const probe = () => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.once('connect', () => {
          socket.destroy();
          if (Date.now() > deadline) {
            reject(new Error(`port ${port} still listening after stop`));
            return;
          }
          setTimeout(probe, 200);
        });
        socket.once('error', () => {
          // ECONNREFUSED / EADDRINUSE-attempt: nothing bound, the port is free.
          resolve();
        });
      };
      probe();
    });
  }
}
