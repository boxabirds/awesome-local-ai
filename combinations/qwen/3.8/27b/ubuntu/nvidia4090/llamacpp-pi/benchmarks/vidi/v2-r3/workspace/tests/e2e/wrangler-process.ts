/**
 * Per-test `wrangler dev` process with `--persist-to`, so Durable Object
 * storage (SQLite) survives kill + restart while all memory is forgotten.
 * The persistence Playwright project uses this instead of the shared
 * webServer, because these tests restart the server mid-test.
 *
 * wrangler spawns workerd as a grandchild, so stopping must kill the whole
 * process group (detached spawn + `kill(-pid)`), exactly like the integration
 * global setup does. Killing only the top `npx` process leaves workerd
 * holding the port, which makes every subsequent "restart" silently hit a
 * stale orphan. `stop()` also waits until the port actually stops answering.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const READY_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 8_000;
const PORT_FREE_TIMEOUT_MS = 15_000;

export class WranglerProcess {
  private proc: ChildProcess | null = null;
  private output = '';
  private readonly persistDir: string;

  constructor(readonly port: number, readonly inspectorPort: number) {
    this.persistDir = mkdtempSync(path.join(tmpdir(), 'vidi6-e2e-'));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts wrangler dev (test env, hooks enabled) and waits until it serves. */
  async start(): Promise<void> {
    // detached => the child leads its own process group, so stop() can kill
    // wrangler + workerd together with process.kill(-pid).
    const proc = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(this.port),
        '--inspector-port',
        String(this.inspectorPort),
        '--ip',
        '127.0.0.1',
        '--persist-to',
        this.persistDir,
        '--env',
        'test',
        '--log-level',
        'error',
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    proc.stdout?.on('data', (d: Buffer) => (this.output += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (this.output += d.toString()));

    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (proc.exitCode !== null) {
        proc.kill('SIGKILL');
        throw new Error(`wrangler exited early (code ${proc.exitCode}):\n${this.output}`);
      }
      try {
        const res = await fetch(`${this.url}/`);
        if (res.ok) {
          this.proc = proc;
          return;
        }
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) {
        this.killGroup(proc);
        throw new Error(`wrangler did not become ready in ${READY_TIMEOUT_MS}ms:\n${this.output}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * Kills the whole process group and waits until the port stops answering,
   * so the next start() binds cleanly. Durable Object SQLite is durable per
   * transaction, so an ungraceful kill loses no committed data.
   */
  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null || !proc.pid) return;
    const pid = proc.pid;

    const exited = new Promise<void>((resolve) => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
    });
    // SIGTERM the group (graceful), then SIGKILL after the grace period.
    this.signalGroup(pid, 'SIGTERM');
    const killTimer = setTimeout(() => this.signalGroup(pid, 'SIGKILL'), STOP_GRACE_MS);
    await exited;
    clearTimeout(killTimer);
    this.signalGroup(pid, 'SIGKILL'); // make sure workerd is truly gone

    // Wait until nothing answers on the port (listener released).
    const deadline = Date.now() + PORT_FREE_TIMEOUT_MS;
    for (;;) {
      let up = false;
      try {
        const res = await fetch(`${this.url}/`, { signal: AbortSignal.timeout(500) });
        up = res.ok;
      } catch {
        up = false;
      }
      if (!up) return;
      if (Date.now() > deadline) {
        throw new Error(`port ${this.port} still in use ${PORT_FREE_TIMEOUT_MS}ms after kill`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Stops (if running) and removes the persist dir. */
  async cleanup(): Promise<void> {
    await this.stop();
    rmSync(this.persistDir, { recursive: true, force: true });
  }

  private signalGroup(pid: number, sig: NodeJS.Signals): void {
    try {
      process.kill(-pid, sig);
    } catch {
      /* group already gone */
    }
  }

  private killGroup(proc: ChildProcess): void {
    if (proc.pid) this.signalGroup(proc.pid, 'SIGKILL');
  }
}
