// Starts and stops a real `wrangler dev` with on-disk persistence, so e2e tests
// can restart the service (a process that forgets all memory) between steps.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const READY_TIMEOUT_MS = 90_000;
const WRANGLER = path.resolve('node_modules/.bin/wrangler');

export class WranglerProcess {
  readonly persistDir = mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
  private child: ChildProcess | null = null;
  private output = '';

  constructor(readonly port: number) {}

  get baseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts `wrangler dev --persist-to <dir>` (test hooks on) and waits until it serves. */
  async start(): Promise<void> {
    if (this.child) throw new Error('already running');
    this.output = '';
    const child = spawn(
      WRANGLER,
      [
        'dev',
        '--port',
        String(this.port),
        '--ip',
        '127.0.0.1',
        '--inspector-port',
        String(this.port + 1000),
        '--persist-to',
        this.persistDir,
        '--var',
        'TEST_HOOKS:1',
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    child.stdout?.on('data', (d: Buffer) => (this.output += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (this.output += d.toString()));
    this.child = child;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${this.output}`);
      try {
        const response = await fetch(this.baseURL);
        if (response.ok) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.kill();
    throw new Error(`wrangler did not become ready:\n${this.output}`);
  }

  /** Kills the whole process group at once (SIGKILL: no graceful shutdown, memory is lost). */
  async kill(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) return;
    this.child = null;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    await exited;
    // Wait until the port is free again.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        await fetch(this.baseURL);
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

  async dispose(): Promise<void> {
    await this.kill();
    rmSync(this.persistDir, { recursive: true, force: true });
  }
}
