// Starts and stops a real `wrangler dev` process with its own persisted state
// directory, so persistence e2e tests can restart the service (story 4).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 250;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => (addr && typeof addr === 'object' ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

export class WranglerProcess {
  private child: ChildProcess | null = null;
  private output = '';
  url = '';

  private constructor(readonly persistDir: string) {}

  /** A fresh, empty persisted state directory (removed by `dispose`). */
  static create(): WranglerProcess {
    return new WranglerProcess(mkdtempSync(join(tmpdir(), 'vidi6-persist-')));
  }

  /** Starts `wrangler dev --persist-to <dir>` on a free port and waits until it serves the client. */
  async start(): Promise<void> {
    if (this.child) throw new Error('already running');
    const port = await freePort();
    const inspector = await freePort();
    this.url = `http://127.0.0.1:${port}`;
    this.output = '';
    const child = spawn(
      'node_modules/.bin/wrangler',
      [
        'dev',
        '--ip', '127.0.0.1',
        '--port', String(port),
        '--inspector-port', String(inspector),
        '--persist-to', this.persistDir,
        '--var', 'TEST_HOOKS:1',
      ],
      { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    child.stdout?.on('data', (d) => (this.output += String(d)));
    child.stderr?.on('data', (d) => (this.output += String(d)));
    this.child = child;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler exited early:\n${this.output}`);
      try {
        const res = await fetch(`${this.url}/`);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error(`wrangler not ready:\n${this.output}`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }

  /** Kills the whole process group at once (no graceful shutdown), like a crash. */
  async kill(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await exited;
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
