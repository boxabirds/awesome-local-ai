import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PERSIST_PORT = 8788;
const READY_TIMEOUT_MS = 60_000;

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(cond: () => Promise<boolean>, what: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A real `wrangler dev --persist-to <dir>` process that can be killed and restarted over the same storage. */
export class WranglerProcess {
  readonly url = `http://localhost:${PERSIST_PORT}`;
  private readonly dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  private child: ChildProcess | undefined;

  async start(): Promise<void> {
    if (await reachable(this.url)) throw new Error(`port ${PERSIST_PORT} is already in use`);
    this.child = spawn(
      'npx',
      ['wrangler', 'dev', '--port', String(PERSIST_PORT), '--persist-to', this.dir, '--var', 'TEST_HOOKS:1'],
      { detached: true, stdio: 'ignore' },
    );
    await waitUntil(() => reachable(this.url), 'wrangler dev to be ready', READY_TIMEOUT_MS);
  }

  /** SIGKILL of the whole process group: the process forgets everything it held in memory. */
  async kill(): Promise<void> {
    const pid = this.child?.pid;
    this.child = undefined;
    if (pid === undefined) return;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await waitUntil(async () => !(await reachable(this.url)), 'wrangler dev to stop', 15_000);
  }

  async restart(): Promise<void> {
    await this.kill();
    await this.start();
  }

  async dispose(): Promise<void> {
    await this.kill();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
