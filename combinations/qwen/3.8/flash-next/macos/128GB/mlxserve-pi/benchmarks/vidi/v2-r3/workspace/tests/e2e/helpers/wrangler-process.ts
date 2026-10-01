// A `wrangler dev` process that a test owns, can kill, and can start again
// against the SAME on-disk state. Story 4's whole claim is that a board is still
// there after the service restarts and after everybody leaves; the only honest way
// to test that end to end is to stop the server for real and bring it back, leaving
// nothing in memory behind.
//
// The board data survives because `--persist-to` points the Durable Object's SQLite
// at a directory that outlives the process: kill the process, start another one on
// the same directory, and the board loads from disk exactly as a redeploy would.
//
// It runs the test build (the client the global webServer just built) and turns on
// the storage hooks with `--var TEST_HOOKS:1`, so the same process can also break a
// saved board for the broken-board test.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface WranglerOptions {
  /** Port to serve on (each spec picks its own so specs never share a server). */
  port: number;
  /** Turn on the `/api/__test/boards/*` storage hooks. Default true. */
  testHooks?: boolean;
}

/**
 * One wrangler dev process, restartable on a private on-disk state directory.
 * `restart()` is the whole point: it stops the process, waits for the port to
 * free, and starts a fresh process on the same data directory.
 */
export class PersistentWrangler {
  readonly origin: string;
  readonly dataDir: string;
  private child: ChildProcess | null = null;
  private log = '';

  constructor(private readonly options: WranglerOptions) {
    this.origin = `http://127.0.0.1:${options.port}`;
    // A private directory inside the project so it is writable in the sandbox and
    // never collides with another spec's state; the caller removes it in `dispose`.
    this.dataDir = mkdtempSync(join(ROOT, '.e2e-persist-'));
  }

  private spawnProcess(): void {
    const args = ['wrangler', 'dev', '--port', String(this.options.port), '--ip', '127.0.0.1', '--persist-to', this.dataDir];
    if (this.options.testHooks !== false) args.push('--var', 'TEST_HOOKS:1');
    const child = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const record = (chunk: Buffer): void => {
      this.log += chunk.toString();
      if (this.log.length > 40_000) this.log = this.log.slice(-20_000);
    };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);
    this.child = child;
  }

  /** Start the server (a no-op if one is already running) and wait until it answers. */
  async start(): Promise<void> {
    if (this.child !== null) return;
    this.spawnProcess();
    await this.waitForUp();
  }

  /** Stop the process and wait for it to exit and the port to be released. */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) return;
    this.child = null;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      child.once('exit', done);
      child.kill('SIGTERM');
      // wrangler's workerd occasionally ignores TERM; force it after a grace and
      // resolve regardless so a stuck child never hangs the suite.
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        void sleep(300).then(done);
      }, 8_000).unref?.();
    });
    await this.waitForPortFree();
  }

  /** The full lifecycle a service restart is: down, then back on the same disk. */
  async restart(): Promise<void> {
    await this.stop();
    await sleep(400);
    await this.start();
  }

  /** POST a storage hook for `boardId` (corrupt-snapshot / repair). Test builds only. */
  async hook(boardId: string, action: 'corrupt-snapshot' | 'repair'): Promise<{ ok?: boolean; error?: string }> {
    const response = await fetch(`${this.origin}/api/__test/boards/${boardId}/${action}`, { method: 'POST' });
    return (await response.json()) as { ok?: boolean; error?: string };
  }

  /** Stop for good and remove the on-disk state directory. */
  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dataDir, { recursive: true, force: true });
  }

  /** The tail of wrangler's output, for a readable failure if the server dies. */
  recentLog(): string {
    return this.log.slice(-4_000);
  }

  private async waitForUp(): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.origin}/`);
        // Any answer that is not a connection error means the server is serving.
        if (response.status < 600) return;
      } catch {
        /* not listening yet */
      }
      if (this.child !== null && this.child.exitCode !== null) {
        throw new Error(`wrangler dev exited early (code ${this.child.exitCode}):\n${this.recentLog()}`);
      }
      await sleep(400);
    }
    throw new Error(`wrangler dev did not come up on ${this.origin}:\n${this.recentLog()}`);
  }

  private async waitForPortFree(): Promise<void> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await fetch(`${this.origin}/`);
        // still answering: the old process has not let go yet
        await sleep(200);
      } catch {
        return; // refused connection: the port is free
      }
    }
  }
}
