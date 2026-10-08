import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * A controllable `wrangler dev --persist-to <path>` process for the e2e
 * persistence tests (story 4, TC-19/TC-20/TC-21).
 *
 * The shared e2e webServer (playwright.config.ts) owns offset 1 of the agent
 * port range; the persistence tests run their OWN wrangler so they can kill
 * and restart it to prove boards survive a process restart. Each persistence
 * test uses its own offset (2/3/4) so a lingering workerd from one test can
 * never shadow another test's port.
 *
 * The process is spawned detached (its own process group) so stop() can kill
 * the whole tree — wrangler dev spawns a workerd child that would otherwise
 * outlive wrangler and keep holding the port. start()/stop() additionally
 * drive the PORT to a known-free state (force-killing stragglers via fuser),
 * so a restart or a stale process from a previous run can never cause a
 * bind failure or a stale-serve.
 */

const AGENT_PORT_FIRST = Number(process.env.AGENT_PORT_FIRST ?? 29104);
const AGENT_PORT_LAST = Number(process.env.AGENT_PORT_LAST ?? 29104);

/**
 * The agent port at `offset`. Throws if the port would escape the
 * $AGENT_PORT_FIRST..$AGENT_PORT_LAST range (NOTES.md: every server must
 * stay inside the range).
 */
export function agentPort(offset: number): number {
  const port = AGENT_PORT_FIRST + offset;
  if (port < AGENT_PORT_FIRST || port > AGENT_PORT_LAST) {
    throw new Error(`port ${port} (offset ${offset}) is outside the allowed range`);
  }
  return port;
}

/** A fresh, unique directory under the OS temp area for --persist-to. */
export function freshPersistDir(): string {
  return join(tmpdir(), `vidi6-persist-${randomBytes(8).toString('hex')}`);
}

export class WranglerProcess {
  readonly port: number;
  readonly persistTo: string;
  private readonly vars: Record<string, string>;

  private child: ChildProcess | null = null;
  private stderrTail = '';

  constructor(port: number, persistTo: string, vars: Record<string, string> = {}) {
    this.port = port;
    this.persistTo = persistTo;
    this.vars = vars;
  }

  /** The base URL to serve the board UI from (e.g. `${url}/b/<boardId>`). */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Frees the port: waits briefly for a dying process to release it, then
   * force-kills whatever still holds it (fuser) and waits again.
   */
  private async freePort(timeoutMs: number): Promise<void> {
    const start = Date.now();
    await this.waitPortFree(2_000).catch(() => undefined);
    if (!(await this.portIsFree())) {
      this.killPortHolder();
      const remaining = Math.max(500, timeoutMs - (Date.now() - start));
      await this.waitPortFree(remaining);
    }
  }

  private killPortHolder(): void {
    try {
      spawnSync('fuser', ['-k', `${this.port}/tcp`], { stdio: 'ignore' });
    } catch {
      // fuser unavailable: the wait will surface the failure.
    }
  }

  /**
   * Spawns `wrangler dev --persist-to <dir>` and resolves once it answers
   * HTTP. Serves the same dist/client the shared webServer built (test mode).
   */
  async start(timeoutMs = 120_000): Promise<void> {
    if (this.child !== null) {
      throw new Error('wrangler already running');
    }
    await this.freePort(10_000);
    mkdirSync(this.persistTo, { recursive: true });
    const args = [
      'wrangler',
      'dev',
      '--port',
      String(this.port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      this.persistTo,
    ];
    // Extra wrangler vars (e.g. TEST_HOOKS:1 for the damage hooks, TC-24).
    // NOTE: wrangler's `--var` uses COLON-separated `KEY:VALUE` pairs (see
    // collectKeyValues in wrangler-dist/cli.js), NOT `KEY=VALUE`.
    for (const [key, value] of Object.entries(this.vars)) {
      args.push('--var', `${key}:${value}`);
    }
    const child = spawn('npx', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[wrangler:${this.port}] ${d}`));
    child.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d).slice(-4000);
      process.stderr.write(`[wrangler:${this.port}:err] ${d}`);
    });
    await this.waitForReady(timeoutMs);
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const child = this.child;
      if (child !== null && child.exitCode !== null) {
        throw new Error(`wrangler exited (code ${child.exitCode}) before becoming ready:\n${this.stderrTail}`);
      }
      try {
        const res = await fetch(this.url);
        if (res.status < 500) {
          return;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`wrangler did not become ready within ${timeoutMs}ms:\n${this.stderrTail}`);
      }
      await sleep(500);
    }
  }

  /**
   * Kills the whole process group (wrangler + workerd) and waits until the
   * port is actually free. Default SIGKILL (the design's "kill and restart" —
   * proves the board is durable on disk, not just in memory).
   */
  async stop(signal: NodeJS.Signals = 'SIGKILL', timeoutMs = 8000): Promise<void> {
    const child = this.child;
    if (child !== null) {
      this.child = null;
      const pid = child.pid;
      if (pid !== undefined) {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              resolve();
            }
          };
          const timer = setTimeout(finish, timeoutMs);
          child.once('exit', finish);
          // Kill the process group (negative pid); fall back to the child.
          try {
            process.kill(-pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {
              // already gone
            }
          }
        });
      }
    }
    // Ensure the port is fully released (force-kill a straggler if needed).
    await this.freePort(10_000);
  }

  /**
   * Kills (SIGKILL) and starts again on the same port + persist dir.
   */
  async restart(timeoutMs = 120_000): Promise<void> {
    await this.stop('SIGKILL');
    await this.start(timeoutMs);
  }

  private async waitPortFree(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.portIsFree()) {
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`port ${this.port} was not freed within ${timeoutMs}ms`);
      }
      await sleep(200);
    }
  }

  private async portIsFree(): Promise<boolean> {
    try {
      const res = await fetch(this.url, { signal: AbortSignal.timeout(300) });
      await res.body?.cancel();
      return false; // something answered: still bound
    } catch {
      return true; // refused / timed out: free
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
