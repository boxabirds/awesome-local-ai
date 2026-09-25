// Starts and kills a real `wrangler dev` process with its own on-disk state (`--persist-to`), so a test can
// prove that boards survive a process that forgets everything in memory.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 60_000;

export class WranglerProcess {
  readonly port: number;
  readonly persistTo: string;
  private child: ChildProcess | null = null;
  private output = '';

  constructor(port: number) {
    this.port = port;
    this.persistTo = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  }

  get baseURL(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts `wrangler dev` over this instance's state directory and waits until it serves the client. */
  async start(): Promise<void> {
    if (this.child) throw new Error('already running');
    this.output = '';
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(this.port),
        '--ip',
        '127.0.0.1',
        '--inspector-port',
        String(this.port + 1000),
        '--persist-to',
        this.persistTo,
        '--var',
        'TEST_HOOKS:1',
        '--show-interactive-dev-session=false',
      ],
      // Own process group, so kill() takes down wrangler and its workerd child together.
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
    );
    child.stdout?.on('data', (d) => (this.output += String(d)));
    child.stderr?.on('data', (d) => (this.output += String(d)));
    this.child = child;
    const start = Date.now();
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${this.output}`);
      try {
        const res = await fetch(`${this.baseURL}/`);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() - start > READY_TIMEOUT_MS) throw new Error(`wrangler did not start:\n${this.output}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Kills the whole process group at once (SIGKILL: no graceful shutdown, like a crash). */
  async kill(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      // already gone
    }
    await exited;
    // Wait until the port is free again.
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${this.baseURL}/`);
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

  /** Kills the process and deletes its state directory. */
  async dispose(): Promise<void> {
    await this.kill();
    rmSync(this.persistTo, { recursive: true, force: true });
  }
}
