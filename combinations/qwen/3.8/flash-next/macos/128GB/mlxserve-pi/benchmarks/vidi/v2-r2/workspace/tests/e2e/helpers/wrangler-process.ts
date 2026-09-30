// A `wrangler dev` process a test owns end to end.
//
// Story 4's guarantees are about *storage outliving the process*, and the only way
// to test that honestly is to kill the process. So these tests start their own
// dev server rather than sharing Playwright's global one: each gets a port of its
// own, a `--persist-to` directory of its own (which is the disk state a restart is
// supposed to find again), and a `restart()` that stops the process and starts
// another one against the very same directory.
//
// Nothing here pretends to be production: it is the same command
// `playwright.config.ts` runs, with two extra flags, and the client bundle the
// global `webServer` already built with `npm run build:test`.

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The spawned `wrangler dev`: no stdin, stdout and stderr piped. */
type Child = ChildProcessByStdio<null, Readable, Readable>;

/** Where a test's board storage lives between process restarts. */
export function newStateDir(label: string): string {
  const base = path.join(ROOT, 'tmp', 'e2e-state');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(path.join(base, `${label}-`));
}

export function removeStateDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A port nothing is listening on at the moment of asking. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not reserve a port'));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}

export interface RoomDiagnostics {
  state: string;
  serving: boolean;
  loaded: boolean;
  sockets: number;
  updates: number;
  bytes: number;
  snapshotThrough: number;
  sinceLoadFailureMs: number | null;
  lastLoadError: string | null;
}

export class WranglerProcess {
  readonly url: string;
  readonly stateDir: string;
  readonly port: number;
  private readonly inspectorPort: number;
  /** Whether this server was started with the room's test hooks. */
  private readonly hooks: boolean;
  private readonly label: string;
  private child: Child | null = null;
  private log: string[] = [];

  private constructor(
    port: number,
    inspectorPort: number,
    stateDir: string,
    label: string,
    hooks: boolean,
  ) {
    this.port = port;
    // Its own port rather than an offset of the server's: two numbers taken from
    // the ephemeral range are both free, whereas `port + 1000` walks off the end of
    // the address space whenever the operating system hands out a high one.
    this.inspectorPort = inspectorPort;
    this.stateDir = stateDir;
    this.label = label;
    this.hooks = hooks;
    this.url = `http://127.0.0.1:${port}`;
  }

  /** Everything the server printed, for a failure message to quote back. */
  output(): string {
    return this.log.join('');
  }

  static async start(options: {
    label: string;
    stateDir?: string;
    testHooks?: boolean;
  }): Promise<WranglerProcess> {
    const hooks = options.testHooks === true;
    // One at a time: two probes asking at the same moment are handed the same port.
    const port = await freePort();
    const inspectorPort = await freePort();
    const server = new WranglerProcess(
      port,
      inspectorPort,
      options.stateDir ?? newStateDir(options.label),
      options.label,
      hooks,
    );
    await server.launch(hooks);
    return server;
  }

  private async launch(testHooks: boolean): Promise<void> {
    const args = [
      'wrangler',
      'dev',
      '--config',
      'wrangler.jsonc',
      '--ip',
      '127.0.0.1',
      '--port',
      String(this.port),
      '--inspector-port',
      String(this.inspectorPort),
      // The Durable Object's SQLite storage lives here, and this is the whole
      // point: a restart finds this directory again.
      '--persist-to',
      this.stateDir,
      '--log-level',
      'warn',
    ];
    if (testHooks) args.push('--var', 'TEST_HOOKS:1');

    const child = spawn('npx', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.log.push(chunk));
    child.stderr.on('data', (chunk: string) => this.log.push(chunk));

    await this.waitForReady(child);
  }

  /** Poll until the server answers, or give up quoting its own output. */
  private async waitForReady(child: Child): Promise<void> {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (child.exitCode !== null) {
        throw new Error(`${this.label}: wrangler dev exited early (code ${child.exitCode}):\n${this.output()}`);
      }
      try {
        const response = await fetch(`${this.url}/`, { signal: AbortSignal.timeout(1_000) });
        if (response.status < 500) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`${this.label}: wrangler dev did not come up on ${this.url}:\n${this.output()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Stop the process and start another one on a new port over the same storage -
   * a worker process restart, with nothing carried across in memory.
   */
  async restart(): Promise<void> {
    await this.stop();
    // The same storage directory, and the same address: a person coming back to the
    // board finds it on another process.
    await this.launch(this.hooks);
  }

  /** Stop the process; the `--persist-to` directory is left on purpose. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(killer);
        resolve();
      };
      const killer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.once('exit', done);
      child.kill('SIGTERM');
    });
  }

  /** Ask a board's room how it is doing (test hooks only). */
  async diagnostics(boardId: string): Promise<RoomDiagnostics> {
    const response = await fetch(`${this.url}/__test/boards/${boardId}/diagnostics`);
    if (!response.ok) {
      throw new Error(`diagnostics for ${boardId}: HTTP ${response.status}\n${this.output()}`);
    }
    return (await response.json()) as RoomDiagnostics;
  }

  /** Run a test hook on a board's room (test hooks only). */
  async hook(boardId: string, action: 'corrupt-snapshot' | 'repair-snapshot'): Promise<RoomDiagnostics> {
    const response = await fetch(`${this.url}/__test/boards/${boardId}/${action}`, { method: 'POST' });
    if (!response.ok) {
      throw new Error(`${action} on ${boardId}: HTTP ${response.status}\n${this.output()}`);
    }
    return (await response.json()) as RoomDiagnostics;
  }

  /**
   * Ask for a path and report what came back, without deciding whether it is a
   * good answer. Used to show the test hooks are not there when the server was
   * started without them: the request is answered by the board itself, because as
   * far as the server is concerned nothing at that address exists.
   */
  async probe(pathname: string, method = 'GET'): Promise<{ status: number; body: string }> {
    const response = await fetch(`${this.url}${pathname}`, { method });
    return { status: response.status, body: await response.text() };
  }

  /** The address a page should open for a board. */
  boardUrl(boardId: string): string {
    return `${this.url}/b/${boardId}`;
  }
}
