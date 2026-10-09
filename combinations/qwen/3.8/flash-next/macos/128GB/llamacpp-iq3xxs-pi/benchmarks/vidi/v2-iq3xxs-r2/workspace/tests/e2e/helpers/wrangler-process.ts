import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A `wrangler dev` process a test owns: its own port, its own `--persist-to`
 * directory, and — what no shared webServer can offer — a `restart()` that kills the
 * process and starts another on the same directory. That is the whole story of
 * story 6's TC-19: the process forgets everything, the storage does not.
 *
 * The directory is fresh per suite, so no test inherits another's board, and
 * `vars` lets the persistence suite turn on the room's test hooks (`TEST_HOOKS=1`)
 * while the production webServer — where their absence is itself tested — never has.
 */
export class WranglerProcess {
  private child: ChildProcess | null = null;
  /** A directory that survives restarts and nothing else, deleted when the suite is done. */
  readonly persistTo: string;

  constructor(
    readonly port: number,
    readonly inspectorPort: number,
    readonly vars: string[] = [],
  ) {
    this.persistTo = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}/`;
  }

  async start(label: string): Promise<void> {
    if (this.child) throw new Error('already running');
    const args = [
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--inspector-port',
      String(this.inspectorPort),
      '--persist-to',
      this.persistTo,
      '--log-level=warn',
      ...this.vars.flatMap((variable) => ['--var', variable]),
    ];
    const child = spawn('npx', ['-y', 'wrangler', ...args], {
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => console.log(`[${label}:wrangler] ${chunk.toString().trimEnd()}`));
    child.stderr?.on('data', (chunk: Buffer) => console.log(`[${label}:wrangler] ${chunk.toString().trimEnd()}`));

    // Readiness is the same question the shared webServer asks of its server: can the
    // board page be fetched yet.
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler exited early (${child.exitCode})`);
      try {
        const answer = await fetch(this.url);
        if (answer.ok) return;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline) throw new Error(`wrangler not ready at ${this.url}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!exited) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }

  /** Forget every byte of memory; keep the storage directory. */
  async restart(label: string): Promise<void> {
    await this.stop();
    await this.start(label);
  }

  dispose(): void {
    try {
      rmSync(this.persistTo, { recursive: true, force: true });
    } catch {
      // A temporary directory outliving a test is the least bad leak there is.
    }
  }
}

/** The hooks live only where the variable lives; this is how a spec addresses them. */
export async function callTestHook(
  server: WranglerProcess,
  boardId: string,
  hook: string,
  query = '',
): Promise<{ status: number; body: unknown }> {
  const answer = await fetch(`${server.url}__test/${boardId}/${hook}${query}`, {
    method: 'POST',
  });
  const body = (await answer.json().catch(() => null)) as unknown;
  return { status: answer.status, body };
}
