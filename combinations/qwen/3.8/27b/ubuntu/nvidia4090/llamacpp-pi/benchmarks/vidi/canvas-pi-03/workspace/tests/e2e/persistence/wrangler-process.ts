/**
 * Story 4 e2e: manages a real `wrangler dev` process per test.
 *
 * The persistence specs need to KILL and RESTART the worker (to prove the
 * room reloads from SQLite once memory is gone), so they cannot use Playwright's
 * shared `webServer`. Each test starts its own process on a dedicated port with
 * its own `--persist-to` tmp dir, and tears it down afterwards. The process is
 * spawned `detached` (own process group) so the whole group — wrangler and its
 * workerd child — can be signalled together and the port is reliably freed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const PERSIST_PORT = Number(process.env.PERSIST_PORT ?? 8791);
const WRANGLER_BIN = path.join('node_modules', '.bin', 'wrangler');

export class WranglerProcess {
  private proc: ChildProcess | null = null;
  private logs = '';
  readonly persistTo: string;
  readonly port: number;

  constructor(opts: { port?: number; persistTo?: string } = {}) {
    this.port = opts.port ?? PERSIST_PORT;
    this.persistTo = opts.persistTo ?? mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Spawns `wrangler dev --persist-to <dir> --var TEST_HOOKS:1` and waits for readiness. */
  async start(): Promise<void> {
    const args = [
      'dev',
      '--port',
      String(this.port),
      '--persist-to',
      this.persistTo,
      '--var',
      'TEST_HOOKS:1',
      '--local',
    ];
    this.proc = spawn(WRANGLER_BIN, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    const proc = this.proc;
    const appendLog = (d: Buffer): void => {
      this.logs += d.toString();
      try {
        appendFileSync('/tmp/vidi6-wrangler-debug.log', d.toString());
      } catch { /* best-effort */ }
    };
    proc.stdout?.on('data', appendLog);
    proc.stderr?.on('data', appendLog);
    await this.waitReady(90_000);
  }

  private async waitReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const res = await fetch(this.url + '/');
        if (res.status === 200) return;
        last = `HTTP ${res.status}`;
      } catch (e) {
        last = String((e as Error).message ?? e);
      }
      await sleep(400);
    }
    throw new Error(
      `wrangler did not become ready on ${this.url} within ${timeoutMs}ms (last: ${last});\n--- logs ---\n${tail(this.logs)}`,
    );
  }

  /** Signals the whole process group; SIGKILL after a grace period. */
  async stop(): Promise<void> {
    if (!this.proc) return;
    const pid = this.proc.pid;
    this.proc = null;
    if (pid === undefined) return;
    const signalGroup = (sig: NodeJS.Signals): void => {
      try {
        process.kill(-pid, sig);
      } catch {
        /* already gone */
      }
    };
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        signalGroup('SIGKILL');
        resolve();
      }, 6000);
      signalGroup('SIGTERM');
      const poll = setInterval(() => {
        let alive = true;
        try {
          process.kill(-pid, 0);
        } catch {
          alive = false;
        }
        if (!alive) {
          clearTimeout(killTimer);
          clearInterval(poll);
          resolve();
        }
      }, 150);
    });
    // Give the kernel a beat to release the listening socket.
    await sleep(200);
  }

  /** Kills and restarts over the SAME persist dir (the "process forgets memory" step). */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  get log(): string {
    return tail(this.logs);
  }
}

function tail(s: string, n = 4000): string {
  return s.length <= n ? s : s.slice(-n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
