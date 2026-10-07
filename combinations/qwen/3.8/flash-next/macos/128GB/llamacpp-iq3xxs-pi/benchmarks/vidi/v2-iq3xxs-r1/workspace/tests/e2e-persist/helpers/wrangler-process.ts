import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Drive a real `wrangler dev` process that persists its Durable Object SQLite to a
 * directory on disk (`--persist-to`). Stopping the process and starting another one
 * pointed at the same directory is what "the Worker process restarted" means to the
 * story: the only thing that survives is the bytes on disk. Nothing here mocks that.
 *
 * Own port pair (25240/25241) so it never collides with the base e2e server
 * (25232/25233) or vite (25234/25235); the whole run stays inside 25232–25247.
 */

const PORT = Number(process.env.VIDI_PERSIST_PORT ?? 25240);
const INSPECTOR = Number(process.env.VIDI_PERSIST_INSPECTOR ?? 25241);

export const BASE_URL = `http://127.0.0.1:${PORT}`;

export interface Handle {
  readonly url: string;
  readonly stateDir: string;
}

export class WranglerDev implements Handle {
  private proc: ChildProcess | undefined;
  readonly url = BASE_URL;

  /** `stateDir` is relative to the repo root (the cwd Playwright runs from). */
  constructor(readonly stateDir: string) {}

  /** Wipe any saved state so a test starts from an empty disk. */
  clearState(): void {
    rmSync(this.stateDir, { recursive: true, force: true });
    mkdirSync(this.stateDir, { recursive: true });
  }

  /** Start wrangler and resolve once it serves HTTP 200. */
  async start(): Promise<void> {
    if (!existsSync(this.stateDir)) mkdirSync(this.stateDir, { recursive: true });
    this.proc = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(PORT),
        '--inspector-port',
        String(INSPECTOR),
        '--persist-to',
        this.stateDir,
        '--var',
        'TEST_HOOKS:1',
      ],
      // A new process group, so stop() can kill wrangler *and* its workerd child.
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    await this.waitReady();
  }

  /** Kill the whole process group (wrangler + workerd) and wait for it to exit. */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc || proc.pid === undefined) return;
    try {
      process.kill(-proc.pid, 'SIGKILL'); // negative pid = the whole group
    } catch {
      // already gone
    }
    await new Promise<void>((resolve) => {
      if (!proc || proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
      setTimeout(resolve, 5000); // never hang a test on a stray process
    });
    // Give the OS a beat to release the port before a restart binds it again.
    await sleep(750);
  }

  dispose(): void {
    rmSync(this.stateDir, { recursive: true, force: true });
  }

  private async waitReady(): Promise<void> {
    const deadline = Date.now() + 90_000; // wrangler's first cold start can be slow
    let last = '';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.url}/`);
        if (res.status === 200) return;
        last = `status ${res.status}`;
      } catch (error) {
        last = String(error);
      }
      await sleep(500);
    }
    throw new Error(`wrangler dev did not become ready on ${this.url}: ${last}`);
  }
}
