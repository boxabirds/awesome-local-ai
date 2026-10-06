/**
 * A `wrangler dev` this test owns, can kill, and can start again.
 *
 * The persistence story is about what survives a process that forgot everything,
 * and there is no way to fake that from inside the process: the suite's shared
 * dev server (playwright.config.ts) has to stay up for the other tests, so a test
 * that wants a restart starts its own on its own port, with its own
 * `--persist-to` directory. The directory is the point: killing the process and
 * starting another one over the same directory is the closest thing to "the server
 * was restarted overnight" that a test can do, and the board has to come back from
 * the SQLite file in it.
 *
 * The process is started in its own process group (`detached`) and killed with a
 * signal to that group, because `wrangler dev` runs the Worker in a separate
 * workerd process: signalling wrangler alone can leave the thing that holds the
 * port alive, which would show up as the next test connecting to a server it never
 * started.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: this file is three directories down from it. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
/** Where the throwaway servers keep their storage. Gitignored, and removed by dispose(). */
const STATE_ROOT = join(ROOT, '.tmp', 'e2e-persistence');
/** The variable that turns `/__test/boards/:id/*` into routes (`src/worker/test-hooks.ts`). */
const HOOKS_VAR = 'TEST_HOOKS:1';

export interface TestHookAnswer {
  status: number;
  json: Record<string, unknown>;
}

export interface WranglerProcess {
  /** Where it answers. */
  readonly baseUrl: string;
  /** The port it actually got: usually the one asked for, and see `choosePair`. */
  readonly port: number;
  /** Its own devtools port; a second `wrangler dev` cannot share one. */
  readonly inspectorPort: number;
  /**
   * The address of a brand-new board on THIS server.
   *
   * Absolute, and rebuilt from the current port on every call. Both halves matter. The
   * suite's `baseURL` is the shared dev server (`playwright.config.ts`), so a relative
   * address handed to `page.goto()` opens a board on a server this test never started and
   * never killed - which makes a restart test pass by remembering the board in a process
   * that is still running. And a server that had to move to another port after a restart
   * would otherwise have its pages reopened on an address that now belongs to nobody, or
   * worse to somebody else. A test holds the board's path and asks this for the address
   * each time it navigates.
   */
  /**
   * A brand-new board on THIS server, made before the path is handed over.
   *
   * Absolute, and rebuilt from the current port on every call. Both halves matter. The
   * suite's `baseURL` is the shared dev server (`playwright.config.ts`), so a relative
   * address handed to `page.goto()` opens a board on a server this test never started and
   * never killed - which makes a restart test pass by remembering the board in a process
   * that is still running. And a server that had to move to another port after a restart
   * would otherwise have its pages reopened on an address that now belongs to nobody, or
   * worse to somebody else. A test holds the board's path and asks this for the address
   * each time it navigates.
   *
   * The board is created by `POST /api/boards` on this server first. Since story 5 an
   * address this server has never heard of is a board that is not there, and a persistence
   * test that opened one and waited for a board to come back would be waiting for a board
   * that was never there.
   */
  newBoardPath(): Promise<string>;
  /** An address on this server, as it is right now: `/b/<id>`, `/api/rooms/:id`, `/health`. */
  urlFor(path: string): string;
  /** The directory its Durable Object storage lives in. Survives `restart()`. */
  readonly persistDir: string;
  /** Start the server and wait until it answers. Called by `startWrangler`, and by `restart`. */
  start(): Promise<void>;
  /** Kill it - signal to the process group - and wait for it to be gone. */
  stop(): Promise<void>;
  /** Kill it, start it again over the same storage. */
  restart(): Promise<void>;
  /** Stop for good and delete the storage directory. */
  dispose(): Promise<void>;
  /** POST one of the room's test routes. */
  hook(boardId: string, action: string, body?: unknown): Promise<TestHookAnswer>;
  /** Everything it printed, for the failure message. */
  output(): string;
}

export interface StartOptions {
  /**
   * The first port to try, and how many pairs to try. Whichever pair is free becomes this
   * server's, and the test reads it back from `port`/`inspectorPort` rather than assuming
   * the one it asked for. See `choosePair` for why a free port is not a detail.
   */
  port: number;
  portTries?: number;
  /** Reuse a directory a previous server in this test wrote, to come back to its storage. */
  persistDir?: string;
  /** How long to wait for it to answer. Cold starts on a loaded machine are slow. */
  readyTimeoutMs?: number;
  /**
   * Start it WITHOUT the room's test routes (default: with them). The production
   * configuration has no `TEST_HOOKS` variable and one test checks what that means,
   * so this is how it asks a server to be production-like: same config, same Worker,
   * without the variable that is deliberately not in `wrangler.jsonc`.
   */
  testHooks?: boolean;
}

class Server implements WranglerProcess {
  private readonly lines: string[] = [];
  private child: ChildProcess | null = null;
  private started = false;

  readonly persistDir: string;
  /** Chosen by `start()`, which is the first moment anything is asked of the OS. */
  port = 0;
  inspectorPort = 0;

  constructor(private readonly options: StartOptions) {
    this.persistDir = options.persistDir ?? makeDirectory(STATE_ROOT);
  }

  get baseUrl(): string {
    if (this.port === 0) throw new Error('this server has not been started yet');
    return `http://127.0.0.1:${this.port}`;
  }

  async newBoardPath(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/boards`, { method: 'POST' });
    if (response.status !== 201) {
      throw new Error(
        `this server would not make a board: ${response.status} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length === 0) {
      throw new Error(`this server made a board with no id: ${JSON.stringify(body)}`);
    }
    return `/b/${body.id}`;
  }

  urlFor(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  output(): string {
    // The last 8 KB is what a failure needs; a dev server prints more than that.
    const text = this.lines.join('');
    return text.length > 8192 ? text.slice(-8192) : text;
  }

  async start(): Promise<void> {
    if (this.child !== null) throw new Error('this server is already running');
    // Nothing may be listening yet. A test that starts a server has to be the thing that
    // answers on its port: a server left over from an earlier run would answer instead,
    // with a configuration this test does not control, and a persistence test pointed at
    // a server that was never restarted - or a routes test pointed at one that was given
    // the routes - passes without meaning anything. A free port before the spawn, and no
    // listener of ours afterwards, is the only honest pairing of a test with its server.
    if (this.port === 0) {
      const pair = await choosePair(this.options.port, this.options.portTries ?? 3);
      this.port = pair.port;
      this.inspectorPort = pair.inspectorPort;
      if (this.port !== this.options.port) {
        console.log(`[e2e] port ${this.options.port} was taken; this server has ${this.port} instead`);
      }
    } else {
      // Starting again, after a restart. This one does not get to move. Pages this test
      // opened are still open, and they reconnect to the address they were loaded from:
      // a server that came back on a different port is a server those pages will never
      // find, and a test that then waited for a board to reappear would be waiting for a
      // recovery that cannot happen for the wrong reason - or, if the new port belonged
      // to another of this suite's servers, would be watching a different board. So the
      // port is insisted on, and losing it is a failure with a message, not a move.
      if (!(await portsAreFree([this.port, this.inspectorPort]))) {
        throw new Error(
          `this server's own ports ${this.port}/${this.inspectorPort} are not free to start ` +
            'it again on - something took them while it was stopped, and every page this test ' +
            'has open would go on reconnecting to an address it no longer answers on',
        );
      }
    }
    if (!this.started) console.log(`[e2e] starting wrangler dev on ${this.baseUrl} (storage: ${this.persistDir})`);
    this.started = true;
    const child = spawn(
      WRANGLER,
      [
        'dev',
        '--ip',
        '127.0.0.1',
        '--port',
        String(this.port),
        '--inspector-port',
        String(this.inspectorPort),
        '--persist-to',
        this.persistDir,
        ...(this.options.testHooks === false ? [] : ['--var', HOOKS_VAR]),
      ],
      { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.lines.push(chunk));
    child.stderr?.on('data', (chunk: string) => this.lines.push(chunk));
    // The exit is awaited by stop(); a death on its own is reported by the readiness wait.
    await this.waitUntilReady();
  }

  private async waitUntilReady(): Promise<void> {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? 120_000);
    let last = 'nothing yet';
    while (Date.now() < deadline) {
      const exit = this.child?.exitCode ?? null;
      if (exit !== null) {
        throw new Error(`wrangler dev exited with ${exit} before it was ready:\n${this.output()}`);
      }
      try {
        const response = await fetch(`${this.baseUrl}/`);
        if (response.status === 200) {
          // The board page is the SPA; a request for it proves the assets are served and
          // the Worker is answering. The room itself is exercised by the page that follows.
          await response.body?.cancel();
          return;
        }
        last = `status ${response.status}`;
        await response.body?.cancel();
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await sleep(250);
    }
    throw new Error(`wrangler dev on ${this.baseUrl} did not answer (${last}):\n${this.output()}`);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null || child.pid === undefined) return;
    await kill(child.pid, this.port);
  }

  async restart(): Promise<void> {
    console.log(`[e2e] restarting the server on port ${this.port}; storage stays in ${this.persistDir}`);
    await this.stop();
    await this.start();
  }

  async dispose(): Promise<void> {
    await this.stop();
    rmSync(this.persistDir, { recursive: true, force: true });
  }

  async hook(boardId: string, action: string, body?: unknown): Promise<TestHookAnswer> {
    const response = await fetch(`${this.baseUrl}/__test/boards/${boardId}/${action}`, {
      method: 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Not JSON: the status is the answer, and the body goes with the failure message.
      json = { body: text.slice(0, 400) };
    }
    return { status: response.status, json };
  }
}

/**
 * Signal the whole process group and wait for the process to be gone. A SIGKILL to
 * the group takes workerd with it; if the group is already gone (a crash) the
 * `ESRCH` is the success we asked for.
 */
async function kill(pid: number, port: number): Promise<void> {
  const gone = new Promise<void>((resolveGone) => {
    const interval = setInterval(() => {
      if (!processIsRunning(pid)) {
        clearInterval(interval);
        resolveGone();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(interval);
      resolveGone();
    }, 10_000).unref();
  });
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await gone;
  // The port has to be free before another server can hold it: a socket left in
  // TIME_WAIT would make the next start fail with EADDRINUSE, and the test would read
  // that as a server that would not start. If it is *still* held after that, something
  // other than our process is listening on it, and the next test would be told about
  // that instead of being quietly handed the wrong server.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await portIsHeld(port))) return;
    await sleep(200);
  }
  throw new Error(
    `port ${port} is still held after the server on it was killed; something else is ` +
      'listening there and a test started against it would not be talking to its own server',
  );
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Whether something is still listening (or holding) that port. */
async function portIsHeld(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * The first pair of ports this test can have: one to serve from, and the devtools port
 * next to it.
 *
 * A test that restarts a server has to be the only thing that ever answered on its port.
 * If a server from an earlier run is still listening - a run that was killed on a timeout,
 * whose `finally` never got the chance to stop the process it started, leaving a
 * `wrangler dev` in its own process group and out of reach of anyone - then this test's
 * requests are answered by a process with a configuration it does not control and a
 * storage directory it has never seen. A persistence test pointed at a server that was
 * never restarted, or a "these routes do not exist" test pointed at one that was given
 * the routes, passes and means nothing. So the rule is: no listener before the spawn, and
 * our own process answering afterwards.
 *
 * "No listener" is asked of the OS by binding, not by making a request: a request cannot
 * tell a free port from a slow listener, and it joins whatever queue is there. Two ports
 * at a time, because a running `wrangler dev` holds the port it serves from and the
 * devtools port next to it, and a pair taken across two servers would collide.
 */
async function choosePair(first: number, tries: number): Promise<{ port: number; inspectorPort: number }> {
  const tried: number[] = [];
  for (let index = 0; index < tries; index += 1) {
    const port = first + index * 2;
    const inspectorPort = port + 1;
    if (port < PORT_FIRST || inspectorPort > PORT_LAST) continue;
    if (await portsAreFree([port, inspectorPort])) return { port, inspectorPort };
    tried.push(port, inspectorPort);
  }
  throw new Error(
    `no free pair of ports in ${tried.join(', ')} - the range a test may use is ` +
      `${PORT_FIRST}-${PORT_LAST}, and something is already listening on the pairs tried`,
  );
}

/** Whether the machine will hand these ports over right now. */
async function portsAreFree(ports: number[]): Promise<boolean> {
  for (const port of ports) {
    if (!(await portIsFree(port))) return false;
  }
  return true;
}

/** Bind to the port and let go again. Taken means taken, whatever is holding it. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once('error', () => resolveFree(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolveFree(true));
    });
  });
}

/** The port range a test may hold, given by the environment. */
const PORT_FIRST = Number(process.env.AGENT_PORT_FIRST ?? 24208);
const PORT_LAST = Number(process.env.AGENT_PORT_LAST ?? 24223);

/** A fresh directory under `root`, whose parent it creates. */
function makeDirectory(root: string): string {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, 'board-'));
}

/** Start a server on its own port, over storage only it owns. */
export async function startWrangler(options: StartOptions): Promise<WranglerProcess> {
  const server = new Server(options);
  await server.start();
  return server;
}

