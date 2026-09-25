import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A real `wrangler dev --persist-to <dir>` process (story 4, task 6).
 *
 * The only way to prove that memory loss (process death) does not lose data
 * is to run the real serving process, kill it, and start it again on the
 * same persistence directory. One instance per test; the persist Playwright
 * project runs with a single worker, so a fixed port is safe.
 */

/** Fixed port for the persist suite (single worker, no shared webServer). */
export const PERSIST_PORT = 8891;
export const PERSIST_URL = `http://127.0.0.1:${PERSIST_PORT}`;

export class WranglerProcess {
  private child: ChildProcess | null = null;
  private persistDir: string | null = null;
  private logs = '';
  private exitCode: number | null | undefined; // undefined = still running
  /** Start with `--env e2e` (TEST_HOOKS=1: the /__test routes exist). */
  private readonly withTestHooks: boolean;

  constructor(options: { testHooks?: boolean } = {}) {
    this.withTestHooks = options.testHooks ?? false;
  }

  /**
   * Start the server (or restart it after `kill()`) on the SAME
   * persistence directory — that is what makes the restart see the data.
   */
  async start(): Promise<void> {
    if (this.child !== null) throw new Error('already started');
    this.persistDir ??= mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
    this.logs = '';
    this.exitCode = undefined;
    // `detached` makes wrangler the leader of its own process group:
    // `wrangler dev` spawns workerd as a child, and a restart must not
    // fight the orphaned one for the port.
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(PERSIST_PORT),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        this.persistDir,
        // TEST_HOOKS-gated /__test routes (TC-24) exist only in the e2e env.
        ...(this.withTestHooks ? ['--env', 'e2e'] : []),
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    this.child = child;
    child.stdout?.on('data', (d: Buffer) => (this.logs += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (this.logs += d.toString()));
    child.once('exit', (code) => (this.exitCode = code));
    await this.waitReady();
  }

  /** Wait until the server answers HTTP (wrangler dev takes several seconds). */
  private async waitReady(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.exitCode !== undefined) {
        throw new Error(
          `wrangler dev exited early (code ${String(this.exitCode)}):\n${this.logs.slice(-4000)}`,
        );
      }
      try {
        const res = await fetch(`${PERSIST_URL}/`);
        if (res.status === 200) return;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        throw new Error(
          `wrangler dev did not become ready within ${timeoutMs}ms:\n${this.logs.slice(-4000)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /**
   * SIGKILL the whole process group: no graceful shutdown, memory is gone,
   * the SQLite files on disk are all that remains — the crash the story
   * guarantees against.
   */
  async kill(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null || child.pid === undefined) return;
    // Capture the pid before the closure: property narrowing does not
    // survive into the promise executor.
    const pid = child.pid;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref?.();
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        clearTimeout(timer);
        resolve();
      }
    });
  }

  /** Captured stdout+stderr of the wrangler process (for failure debugging). */
  get logTail(): string {
    return this.logs.slice(-4000);
  }

  /** Kill and remove the persistence directory (end of test). */
  async dispose(): Promise<void> {
    await this.kill();
    if (this.persistDir !== null) {
      rmSync(this.persistDir, { recursive: true, force: true });
      this.persistDir = null;
    }
  }
}
