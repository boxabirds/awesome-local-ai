import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

/** A real `wrangler dev` whose Durable Object storage lives in `persistDir`, so it can be killed and restarted. */
export class WranglerProcess {
  private child: ChildProcess | null = null;
  readonly url: string;

  constructor(
    private readonly port: number,
    private readonly persistDir: string,
  ) {
    this.url = `http://localhost:${port}`;
  }

  /** workerd may live in its own process group: kill whatever still listens on our port. */
  private killPortListeners(): void {
    try {
      const pids = execFileSync('lsof', ['-ti', 'tcp:' + this.port, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean);
      for (const pid of pids) process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* nothing listening */
    }
  }

  async start(): Promise<void> {
    this.killPortListeners();
    const child = spawn('npx', ['wrangler', 'dev', '--port', String(this.port), '--persist-to', this.persistDir, '--var', 'TEST_HOOKS:1'], {
      detached: true, // own process group, so the whole tree (npx, wrangler, workerd) can be killed at once
      stdio: 'ignore',
    });
    this.child = child;
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const res = await fetch(`${this.url}/`);
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      if (child.exitCode !== null) throw new Error(`wrangler exited with ${child.exitCode}`);
      if (Date.now() > deadline) throw new Error('wrangler dev did not become ready');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Kills the process tree without any chance to flush memory (a crash/restart). */
  async kill(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    this.killPortListeners();
    // Wait for the port to be released so the next start can bind it.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        await fetch(`${this.url}/`, { signal: AbortSignal.timeout(500) });
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async restart(): Promise<void> {
    await this.kill();
    await this.start();
  }
}
