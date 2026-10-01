import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 60_000;

/** A real `wrangler dev` process with persisted local state, which tests can kill and restart. */
export class WranglerProcess {
  readonly dir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  private child: ChildProcess | null = null;

  constructor(readonly port: number) {}

  get url(): string { return `http://localhost:${this.port}`; }

  async start(): Promise<void> {
    const child = spawn(
      join(process.cwd(), 'node_modules/.bin/wrangler'),
      ['dev', '--port', String(this.port), '--persist-to', this.dir, '--var', 'TEST_HOOKS:1', '--inspector-port', '0'],
      { detached: true, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    this.child = child;
    const start = Date.now();
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler exited with ${child.exitCode}`);
      try {
        const res = await fetch(this.url);
        if (res.ok) return;
      } catch { /* not listening yet */ }
      if (Date.now() - start > READY_TIMEOUT_MS) throw new Error('wrangler dev did not become ready');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Kills the whole process tree without letting anything shut down gracefully. */
  async kill(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.pid === undefined) return;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    await new Promise((r) => setTimeout(r, 300)); // let the OS release the port
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
