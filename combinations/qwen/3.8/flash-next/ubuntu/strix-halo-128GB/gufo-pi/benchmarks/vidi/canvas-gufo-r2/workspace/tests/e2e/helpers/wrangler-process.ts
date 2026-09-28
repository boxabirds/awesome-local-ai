/**
 * Runs a private `wrangler dev` for the persistence e2e specs.
 *
 * These tests need something the shared Playwright dev server cannot give them:
 * state on disk (`--persist-to`), the test-only storage routes
 * (`wrangler.hooks.jsonc` sets TEST_HOOKS=1), and the ability to kill the
 * process and start it again against the same files - which is what "the
 * container went away overnight" means locally.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WRANGLER_BIN = path.resolve('node_modules/wrangler/bin/wrangler.js');
const LOG_PATH = path.resolve('.wrangler-persistence.log');

export interface StartOptions {
  port?: number;
  config?: string;
  /** Reuse an existing persistence directory (used by restart). */
  persistDir?: string;
}

export class WranglerProcess {
  readonly baseUrl: string;
  readonly persistDir: string;
  private child: ChildProcess | null = null;
  private log = '';

  private constructor(
    readonly port: number,
    readonly config: string,
    persistDir: string,
  ) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.persistDir = persistDir;
  }

  static async start(options: StartOptions = {}): Promise<WranglerProcess> {
    const port = options.port ?? 8791;
    const config = options.config ?? 'wrangler.hooks.jsonc';
    const persistDir = options.persistDir ?? mkdtempSync(path.join(tmpdir(), 'vidi6-persist-'));
    const proc = new WranglerProcess(port, config, persistDir);
    await proc.launch();
    return proc;
  }

  private async launch(): Promise<void> {
    const args = [
      WRANGLER_BIN,
      'dev',
      '--config',
      this.config,
      '--ip',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--persist-to',
      this.persistDir,
      '--no-local',
    ];
    // A detached process group so `wrangler dev`'s child processes die with it.
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
      cwd: process.cwd(),
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => this.append(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.append(chunk));

    await this.waitForReady();
  }

  private append(chunk: Buffer): void {
    this.log += chunk.toString();
    if (this.log.length > 200_000) this.log = this.log.slice(-100_000);
  }

  private async waitForReady(timeoutMs = 180_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.child && this.child.exitCode !== null) {
        throw new Error(`wrangler dev exited early (code ${this.child.exitCode}):\n${this.tail()}`);
      }
      try {
        const res = await fetch(`${this.baseUrl}/`, { signal: AbortSignal.timeout(2000) });
        if (res.status < 500) return;
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`wrangler dev did not become ready on ${this.baseUrl}:\n${this.tail()}`);
  }

  tail(lines = 60): string {
    writeFileSync(LOG_PATH, this.log);
    return this.log.split('\n').slice(-lines).join('\n');
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    const pid = child?.pid;
    if (!child || pid === undefined) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once('exit', finish);
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        try {
          child.kill('SIGTERM');
        } catch {
          finish();
          return;
        }
      }
      setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // already gone
        }
        finish();
      }, 5000);
    });
    // Give the OS a moment to release the port before a restart binds it.
    await new Promise((r) => setTimeout(r, 500));
  }

  /** Kill the process and start it again against the same on-disk state. */
  async restart(): Promise<void> {
    await this.stop();
    await this.launch();
  }

  removePersistDir(): void {
    try {
      rmSync(this.persistDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  /** Call a test-only storage route on the board's Durable Object. */
  async hook<T = Record<string, unknown>>(
    boardId: string,
    action: string,
    params: Record<string, string | number> = {},
    method: 'POST' | 'GET' = 'POST',
  ): Promise<T> {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    const url = `${this.baseUrl}/__test/boards/${boardId}/${action}${query ? `?${query}` : ''}`;
    const res = await fetch(url, { method });
    if (!res.ok) {
      throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}\n${this.tail()}`);
    }
    return (await res.json()) as T;
  }

  stats(boardId: string): Promise<Record<string, number | string>> {
    return this.hook(boardId, 'stats', {}, 'GET');
  }

  /** True when wrangler has written board state for this DO to the disk. */
  hasPersistedBoardData(): boolean {
    const stack = [this.persistDir];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (/\.sqlite(-wal)?$/.test(entry.name)) {
          try {
            if (statSync(full).size > 4096) return true;
          } catch {
            // raced with a cleanup
          }
        }
      }
    }
    return false;
  }
}
