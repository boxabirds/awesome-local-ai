/**
 * A `wrangler dev` process that belongs to one test.
 *
 * Story 1 to 3's e2e cases share a single server, which is the right shape for
 * questions about screens. The questions here are about the machine underneath:
 * "the board was still there after the process was killed and started again" cannot
 * be answered by a server that was never stopped. So a persistence case starts its
 * own Worker on its own port, with its Durable Object storage in a directory it
 * chooses, and stops it — with `SIGKILL` by default, because a graceful shutdown
 * would let the process empty its buffers on the way out and prove nothing.
 *
 * Starting again on the same directory is the whole test: whatever is on disk is
 * what the board has.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/**
 * Its own port, clear of the shared e2e server (28736) and of the live integration
 * server (28741). Persistence cases run one after another, so they share this one.
 */
export const PERSIST_E2E_PORT = Number(process.env.VIDI6_PERSIST_E2E_PORT ?? 28744);

const STARTUP_TIMEOUT_MS = 180_000;

export interface BoardServerOptions {
  /** Where the Durable Object's data lives. Reuse it to come back to the same board. */
  persistTo: string;
  port?: number;
  /** Arm `/__test/boards/:id/...` in the Worker. A production deploy never sets it. */
  testHooks?: boolean;
}

export class BoardServer {
  readonly port: number;
  readonly persistTo: string;
  private readonly hooks: boolean;
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private output = '';

  constructor(options: BoardServerOptions) {
    this.port = options.port ?? PERSIST_E2E_PORT;
    this.persistTo = options.persistTo;
    this.hooks = options.testHooks ?? false;
  }

  /** What to give `page.goto` and the test-hook client. */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get running(): boolean {
    return this.child !== null;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('this board server is already running');
    const args = [
      WRANGLER,
      'dev',
      '--config',
      join(ROOT, 'wrangler.jsonc'),
      '--ip',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--inspector-port',
      String(this.port + 1),
      '--persist-to',
      this.persistTo,
      '--log-level',
      'error',
      // The Worker reads this to decide whether the test-only routes exist.
      ...(this.hooks ? ['--var', 'TEST_HOOKS:1'] : []),
    ];
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      // Its own process group: `wrangler dev` runs workerd as a child of its own,
      // and stopping the board means stopping both.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.output = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.record(chunk));
    child.stderr?.on('data', (chunk: string) => this.record(chunk));

    try {
      await this.waitForReadiness(child);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the process. `SIGKILL` is the default because these cases are asking what
   * survived, and a signal the process can react to would answer it for them.
   */
  async stop(signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    this.signalGroup(child.pid, signal);
    if (!(await within(exited, 10_000))) {
      this.signalGroup(child.pid, 'SIGKILL');
      await within(exited, 10_000);
    }
  }

  /** Stop and come back with the same data on disk. */
  async restart(signal: NodeJS.Signals = 'SIGKILL'): Promise<void> {
    await this.stop(signal);
    await this.start();
  }

  /** Everything the process printed, for a failure message. */
  get log(): string {
    return this.output;
  }

  private record(chunk: string): void {
    this.output = (this.output + chunk).slice(-20_000);
  }

  private signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
    if (pid === undefined) return;
    try {
      // The minus sign is the process group, which is what `detached` created.
      process.kill(-pid, signal);
    } catch {
      // Already gone, or not a group leader: try the process itself.
      try {
        process.kill(pid, signal);
      } catch {
        /* It has already exited. */
      }
    }
  }

  private async waitForReadiness(
    child: ChildProcessByStdio<null, Readable, Readable> | null,
  ): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    for (;;) {
      if (child && (child.exitCode !== null || child.signalCode !== null)) {
        const code = child.exitCode ?? child.signalCode;
        throw new Error(`the board server exited before it was ready (code ${code}):\n${this.output}`);
      }
      if (await responds(this.origin)) return;
      if (Date.now() > deadline) {
        throw new Error(`the board server did not start in time:\n${this.output}`);
      }
      await sleep(300);
    }
  }
}

/** A directory for one run's board data, outside the repository. */
export async function createPersistDirectory(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `vidi6-${label}-`));
}

export async function removePersistDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function responds(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether `promise` settles first, without keeping the run waiting forever. */
async function within(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
