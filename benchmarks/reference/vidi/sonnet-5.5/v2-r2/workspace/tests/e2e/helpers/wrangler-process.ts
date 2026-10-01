import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A `wrangler dev --persist-to <dir>` process that tests can kill and restart over the same storage. */
export class WranglerProcess {
  private child: ChildProcess | null = null;
  readonly dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));

  constructor(readonly port: number) {}

  get url(): string {
    return `http://localhost:${this.port}`;
  }

  async start(): Promise<void> {
    const child = spawn(
      'npx',
      ['wrangler', 'dev', '--port', String(this.port), '--persist-to', this.dir, '--var', 'TEST_HOOKS:1'],
      { stdio: 'ignore', detached: true },
    );
    this.child = child;
    const start = Date.now();
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler exited with ${child.exitCode}`);
      try {
        const res = await fetch(this.url);
        if (res.status < 500) return;
      } catch { /* not listening yet */ }
      if (Date.now() - start > 90_000) throw new Error('wrangler dev did not become ready');
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  /** Kills the whole process group (wrangler and its workerd child) and waits for exit. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.pid === undefined) return;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.dir, { recursive: true, force: true });
  }
}
