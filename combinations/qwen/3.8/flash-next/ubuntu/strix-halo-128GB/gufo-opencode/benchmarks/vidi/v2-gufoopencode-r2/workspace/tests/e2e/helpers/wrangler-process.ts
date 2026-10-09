// Starts and stops real `wrangler dev` processes against a persistent
// --persist-to directory, so an e2e test can KILL the server and start a
// NEW process over the same on-disk Durable Object storage. This is the
// only honest way to prove story 4: the browser and the process forget
// everything, the disk does not.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface WranglerProcessOptions {
  port: number;
  inspectorPort: number;
  /** false to run WITHOUT TEST_HOOKS=1 (production route verification). */
  hooks?: boolean;
  /** Reuse an existing --persist-to directory (production-view checks). */
  reusePersistDir?: string;
}

export class WranglerProcess {
  persistDir: string;
  private proc: ChildProcess | null = null;
  private exited: Promise<number> | null = null;
  private exitCode: number | null = null;
  private stderrTail = '';

  constructor(private readonly opts: WranglerProcessOptions) {
    this.persistDir = opts.reusePersistDir ?? mkdtempSync(join(tmpdir(), 'vidi6-persistence-'));
  }

  /** After the other instance stopped: take over its storage directory. */
  useStorageOf(other: WranglerProcess): void {
    if (this.proc) throw new Error('cannot switch storage while running');
    this.persistDir = other.persistDir;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.opts.port}`;
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error('wrangler process already running');
    const proc = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(this.opts.port),
        '--inspector-port',
        String(this.opts.inspectorPort),
        '--persist-to',
        this.persistDir,
        '--config',
        'wrangler.jsonc',
        '--var',
        `TEST_HOOKS:${this.opts.hooks === false ? '0' : '1'}`,
        '--log-level',
        'warn',
      ],
      {
        cwd: process.cwd(),
        detached: true, // own process group, so stop() can kill wrangler AND workerd
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, CI: '1' },
      },
    );
    this.proc = proc;
    this.stderrTail = '';
    this.exitCode = null;
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000);
    });
    this.exited = new Promise<number>((resolve) => {
      proc.on('exit', (code) => {
        this.exitCode = code ?? -1;
        resolve(this.exitCode);
      });
    });
    await this.waitForReady();
  }

  /** Graceful stop (SIGTERM to the whole group): wrangler flushes DO state. */
  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc || !this.exited || proc.pid === undefined) return;
    const pgid = proc.pid;
    this.proc = null;
    try {
      process.kill(-pgid, 'SIGTERM');
    } catch {
      // Already dead: the exit promise resolves with its recorded code.
    }
    const code = await Promise.race([
      this.exited,
      new Promise<number>((resolve) => setTimeout(() => resolve(-99), 30_000)),
    ]);
    if (code === -99) {
      try {
        process.kill(-pgid, 'SIGKILL');
      } catch {
        // gone
      }
      throw new Error(`wrangler did not exit on SIGTERM:\n${this.stderrTail}`);
    }
    this.exited = null;
  }

  cleanup(): void {
    rmSync(this.persistDir, { recursive: true, force: true });
  }

  private async waitForReady(timeoutMs = 180_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.exitCode !== null) {
        throw new Error(`wrangler exited (code ${this.exitCode}) before becoming ready:\n${this.stderrTail}`);
      }
      try {
        const res = await fetch(this.baseUrl, { signal: AbortSignal.timeout(2_000) });
        if (res.ok) return;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        throw new Error(`wrangler not ready within ${timeoutMs}ms:\n${this.stderrTail}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
