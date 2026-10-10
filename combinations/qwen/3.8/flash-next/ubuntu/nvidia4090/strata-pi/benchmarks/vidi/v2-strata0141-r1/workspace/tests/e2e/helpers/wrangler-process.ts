import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A `wrangler dev` process a test owns (task: E2E persistence).
 *
 * The shared Playwright `webServer` is one long-lived Worker, which is the right
 * shape for everything except restart tests: to show that a board survives the
 * process forgetting its memory, the process has to actually go away, and its
 * Durable Object storage has to actually live in a directory between runs
 * (`--persist-to`).
 *
 * Each of these gets
 * - its own port, taken from the block this project is allowed to bind
 *   (24070-24079, clear of the shared server on 24064),
 * - its own inspector port, so two of them never fight over 9229,
 * - its own temporary state directory, which `stop()` deletes.
 *
 * `restart()` is the whole point: it terminates the process group, waits for the
 * port to be free again, and starts a new process over the same directory. What
 * survives is only what was written to that directory.
 */

const PORT_FIRST = 24070;
const PORT_LAST = 24079;
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 20_000;

export interface WranglerProcessOptions {
  /** Named for the log lines, e.g. "tc19". */
  label: string;
  /** Pass `TEST_HOOKS=1`, so the storage test hooks answer on this server. */
  testHooks?: boolean;
  /** Reuse a directory (a restart), rather than starting from an empty one. */
  persistTo?: string;
}

const isFree = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, '127.0.0.1');
  });

const waitForPort = async (port: number, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isFree(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`port ${port} never became free`);
};

const waitForHttp = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no attempt yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${url} never became ready: ${lastError}`);
};

export class WranglerProcess {
  readonly port: number;
  readonly url: string;
  readonly persistTo: string;
  readonly label: string;
  private readonly testHooks: boolean;

  private child: ChildProcess | null = null;
  private output = '';

  private constructor(port: number, persistTo: string, options: WranglerProcessOptions) {
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.persistTo = persistTo;
    this.label = options.label;
    this.testHooks = options.testHooks === true;
  }

  /** Start a process on a free port, serving the client build already in `dist`. */
  static async start(options: WranglerProcessOptions): Promise<WranglerProcess> {
    let port = 0;
    for (let candidate = PORT_FIRST; candidate <= PORT_LAST; candidate += 1) {
      if (await isFree(candidate)) {
        port = candidate;
        break;
      }
    }
    if (port === 0) {
      throw new Error(`no free port in ${PORT_FIRST}-${PORT_LAST} for ${options.label}`);
    }
    if (!existsSync(path.join('dist', 'client', 'index.html'))) {
      throw new Error('dist/client/index.html is missing; run `npm run build:test` first');
    }

    const persistTo = options.persistTo ?? mkdtempSync(path.join(tmpdir(), `vidi6-${options.label}-`));
    const server = new WranglerProcess(port, persistTo, options);
    await server.run();
    return server;
  }

  private async run(): Promise<void> {
    const args = [
      'wrangler',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--inspector-port',
      String(this.port + 500),
      '--persist-to',
      this.persistTo,
      '--show-interactive-dev-session=false',
    ];
    if (this.testHooks) {
      args.push('--var', 'TEST_HOOKS:1');
    }

    this.child = spawn('npx', args, {
      detached: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.output += chunk.toString();
    });
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.output += chunk.toString();
    });

    try {
      await waitForHttp(`${this.url}/`, START_TIMEOUT_MS);
    } catch (error) {
      throw new Error(
        `${this.label}: ${error instanceof Error ? error.message : String(error)}\n${this.tail()}`,
      );
    }
  }

  /** Kill this process group, then start again over the same state directory. */
  async restart(options: { hard?: boolean } = {}): Promise<void> {
    await this.stopProcess(options.hard === true);
    await waitForPort(this.port, STOP_TIMEOUT_MS);
    this.output = '';
    await this.run();
  }

  /** Stop serving, and delete everything this server kept. */
  async stop(options: { deleteState?: boolean; hard?: boolean } = {}): Promise<void> {
    await this.stopProcess(options.hard === true);
    if (options.deleteState !== false) {
      rmSync(this.persistTo, { recursive: true, force: true });
    }
  }

  /**
   * Terminate the process. `hard` sends SIGKILL: no chance to flush anything,
   * which is the harsher case a stored board has to survive.
   */
  private async stopProcess(hard: boolean): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null || child.pid === undefined) {
      return;
    }
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      const timer = setTimeout(() => resolve(), STOP_TIMEOUT_MS);
      child.once('exit', () => clearTimeout(timer));
    });
    const signal = hard ? 'SIGKILL' : 'SIGTERM';
    try {
      // The group, because `npx wrangler` runs workerd as a child of its own.
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
    await exited;
  }

  /** The last lines of this server's log, for a failure message. */
  tail(lines = 30): string {
    return this.output.split('\n').slice(-lines).join('\n');
  }
}

/** Call the storage test hooks on one of these servers. */
export async function callHook(
  server: WranglerProcess | { url: string },
  boardId: string,
  action: string,
  method: 'POST' | 'GET' = 'POST',
  body?: unknown,
): Promise<{ ok: boolean; [key: string]: unknown }> {
  const response = await fetch(`${server.url}/__test/boards/${boardId}/${action}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`hook ${action} answered ${response.status}: ${text}`);
  }
  return JSON.parse(text) as { ok: boolean; [key: string]: unknown };
}
