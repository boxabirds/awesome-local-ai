import { spawn, type ChildProcess } from 'node:child_process';

/** A real `wrangler dev --persist-to <dir>` process that tests can kill and restart. */
export class WranglerProcess {
  private child: ChildProcess | null = null;

  constructor(readonly port: number, readonly persistDir: string) {}

  get baseURL(): string { return `http://localhost:${this.port}`; }

  async start(): Promise<void> {
    const child = spawn(
      'npx',
      ['wrangler', 'dev', '--port', String(this.port), '--persist-to', this.persistDir, '--var', 'TEST_HOOKS:1'],
      { detached: true, stdio: 'ignore' },
    );
    this.child = child;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(this.baseURL);
        if (res.ok) return;
      } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    await this.kill();
    throw new Error('wrangler dev did not become ready');
  }

  /** SIGKILL the whole process group: the process forgets all memory, only persisted state remains. */
  async kill(): Promise<void> {
    const child = this.child;
    if (!child?.pid) return;
    this.child = null;
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    // Wait until the port is released so the next start can bind it.
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(this.baseURL, { signal: AbortSignal.timeout(500) }); } catch { return; }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async restart(): Promise<void> {
    await this.kill();
    await this.start();
  }
}
