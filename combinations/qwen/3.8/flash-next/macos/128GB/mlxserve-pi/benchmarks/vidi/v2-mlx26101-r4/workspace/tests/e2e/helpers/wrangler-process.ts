/**
 * A `wrangler dev` process that a test owns: started, stopped, and started again
 * against the same directory on disk.
 *
 * This exists because one of the things story 4 claims cannot be tested against a
 * server that never stops. Every other e2e helper runs against the runtime Playwright
 * starts for the whole suite, whose memory is alive from beginning to end — and a board
 * that survives in memory is not evidence of anything. "Close the laptop, open it in the
 * morning" is a process that goes away and comes back with only what it wrote down, so
 * the test needs to be able to make that happen on purpose:
 *
 *  - its own port, so it can be put next to the suite's server rather than instead of it;
 *  - its own `--persist-to` directory, so the board it stores is this test's board and
 *    the run cannot read a leftover from an earlier one;
 *  - `--var TEST_HOOKS:1`, given here on the command line and never written into
 *    `wrangler.jsonc`, which mounts the routes that damage and repair a stored board;
 *  - a stop that is known to have finished, for the reason below.
 *
 * **The stop is the part that has to be honest.** A test that restarts a server which is
 * still running proves nothing: the old process would go on answering on the same port
 * with the board still in its memory, and the test would pass while the board was never
 * read off disk once. So `stop()` waits for the process to be gone *and* for the port to
 * refuse connections, and throws if either does not happen. `restart()` is the only way
 * a persistence test gets its "next day", and it cannot lie about it.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { resolve } from 'node:path';

/** The ports this machine is allowed to use (see NOTES.md and playwright.config.ts). */
const PORT_RANGE = { from: 22880, to: 22895 };

/** How long to wait for `wrangler dev` to answer the first request. */
const READY_TIMEOUT_MS = 180_000;
/** How long to wait for a stopped runtime to let go of its port. */
const GONE_TIMEOUT_MS = 30_000;

/** Where the stored boards of a test's runtime live; removed unless a test asks to keep them. */
const PERSIST_ROOT = resolve('test-results');

export interface RunningRuntime {
  /** `http://127.0.0.1:<port>`, for a page to open with an absolute address. */
  readonly url: string;
  readonly port: number;
  /** The directory this runtime was told to store boards in. */
  readonly persistTo: string;
  /** Whether the test-only routes are mounted on this runtime. */
  readonly testHooks: boolean;
  /** Everything the runtime wrote, which is what a failure message is made of. */
  output(): string;
  /** Stop it, and wait until nothing is answering on the port any more. */
  stop(): Promise<void>;
  /**
   * Stop it and start it again, on the same port, over the same directory: the restart
   * a person gets when they close the laptop and open it again. The board has to come
   * from the disk, because there is nothing else for it to come from.
   */
  restart(): Promise<RunningRuntime>;
  /** Throw the directory away (only safe once nothing is using it). */
  discard(): void;
}

export interface StartOptions {
  /** Reuse an existing directory: what `restart` does, and what a test given a board must do. */
  persistTo?: string;
  /** Port to try first. The first free pair in the range from here is used. */
  port?: number;
  /** Mount the test-only storage routes. Default: true, because a test is starting this. */
  testHooks?: boolean;
}

/**
 * Start a runtime and wait until it serves the app.
 *
 * Readiness is one request to `/` answered with the app's own HTML: not a port that
 * accepts connections (`wrangler dev` opens its socket before the Worker is built), and
 * not a `/api` address, which a runtime answers even with nothing stored.
 */
export async function startRuntime(options: StartOptions = {}): Promise<RunningRuntime> {
  const testHooks = options.testHooks ?? true;
  const persistTo = options.persistTo ?? mkdtempSync(resolve(PERSIST_ROOT, 'persist-'));
  const port = await freePort(options.port ?? PORT_RANGE.from);
  const inspectorPort = port + 1;

  const args = [
    'dev',
    '--config',
    'wrangler.jsonc',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--inspector-port',
    String(inspectorPort),
    '--persist-to',
    persistTo,
    '--log-level',
    'warn',
  ];
  // Only ever here, on the command line of a test's own runtime: `wrangler.jsonc` does
  // not mention it, so a Worker started any other way has no such addresses.
  if (testHooks) args.push('--var', 'TEST_HOOKS:1');

  const output: string[] = [];
  // `detached` so the whole process group can be signalled: `wrangler dev` is a wrapper
  // around a runtime process of its own, and killing the wrapper leaves the runtime
  // holding the port, which is the failure this file exists to avoid.
  //
  // wrangler's own entry point, and not `npx wrangler`: npx is a second wrapper between this process
  // and the one that owns the runtime, it takes a moment to resolve a package this machine already
  // has, and a signal to the group has to travel through one more process that is free to have
  // already stepped aside. Spawning the entry directly means the process this file holds is the one
  // that holds the runtime.
  const child = spawn(process.execPath, [resolve('node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer): void => {
    output.push(String(chunk));
    // A runtime that is asked to hold 2000 notes has a great deal to say.
    if (output.length > 400) output.splice(0, output.length - 400);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const url = `http://127.0.0.1:${port}`;
  const runtime: RunningRuntime = {
    url,
    port,
    persistTo,
    testHooks,
    output: () => output.join(''),
    stop: async () => {
      await kill(child.pid, port, () => output.join(''));
    },
    restart: async () => {
      await runtime.stop();
      return startRuntime({ persistTo, port, testHooks });
    },
    discard: () => {
      rmSync(persistTo, { recursive: true, force: true });
    },
  };

  await waitForApp(url, () => output.join(''));
  return runtime;
}

/** A directory for one test's boards, inside the project so it can be written here. */
export function freshPersistDir(hint = 'board'): string {
  return mkdtempSync(resolve(PERSIST_ROOT, `persist-${hint}-`));
}

/** Whether an address answers with the app; used for readiness and for "is it really down". */
async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** Nothing is listening here — the state a restart requires before it can begin. */
function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket: Socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      done(false);
    });
    socket.on('error', () => done(true));
    socket.setTimeout(2000, () => {
      socket.destroy();
      done(true);
    });
  });
}

async function freePort(from: number): Promise<number> {
  for (let port = from; port + 1 <= PORT_RANGE.to; port += 1) {
    // The suite's own server is expected to be up on its pair, so "free" is the test.
    if ((await portFree(port)) && (await portFree(port + 1))) return port;
  }
  throw new Error(`no free port pair in ${PORT_RANGE.from}-${PORT_RANGE.to} for a second runtime`);
}

/** Wait for the app to be served; the first request builds the Worker, so this is patient. */
async function waitForApp(url: string, output: () => string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (await responds(url)) return;
    if (Date.now() > deadline) {
      throw new Error(`the runtime at ${url} never served the app within ${READY_TIMEOUT_MS} ms:\n${output()}`);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

/**
 * Stop a runtime and prove it stopped.
 *
 * The process group is signalled rather than the process, then waited for, then the port
 * is waited for. All three, in that order: `wrangler dev` exits by itself some time after
 * the runtime it wrapped has gone, and the port is what tells whether a restart is real.
 */
async function kill(pid: number | undefined, port: number, output: () => string): Promise<void> {
  if (pid === undefined) return;
  // Refused signals are collected rather than swallowed. A signal that could not be sent is not the
  // same fact as a process that was already gone, and when a stop fails the difference is the whole
  // explanation: "the runtime ignored it" and "this machine would not let me say anything to it" look
  // identical from where the port check sits.
  const refused: string[] = [];
  const signal = (signature: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signature);
    } catch (error) {
      const code = (error as { code?: string }).code ?? String(error);
      // Already gone: the ordinary case after the second signal, and not something to make a fuss
      // about. Anything else is a machine that would not do as it was asked, and gets said out loud.
      if (code !== 'ESRCH') refused.push(`${signature} ${code}`);
    }
  };
  const describe = (): string =>
    `${refused.length === 0 ? 'no signal was refused' : `refused: ${refused.join(', ')}`}
${output()}`;

  signal('SIGTERM');
  await both(
    async () => exited(pid),
    GONE_TIMEOUT_MS,
    () => {
      signal('SIGKILL');
    },
  );
  // And the same, unconditionally: `wrangler dev` is a wrapper, and a wrapper that has exited is not
  // evidence about the runtime it was running. A runtime process that outlives its wrapper keeps the
  // port and the board in its memory, which is exactly the thing a restart must not be able to mistake
  // for a board read off disk. The port check below is what this file refuses to lie about; this is
  // what makes it pass honestly rather than hopefully.
  signal('SIGKILL');
  const gone = await both(async () => portFree(port), GONE_TIMEOUT_MS);
  if (!gone) {
    throw new Error(
      `the runtime on port ${port} is still answering after being stopped; a "restart" against it would find the ` +
        `board in the memory of a process that never went away, so this test refuses to continue.\n` +
        describe(),
    );
  }
}

/** Poll until the check says yes; `giveUp` runs once if it never does. */
async function both(check: () => Promise<boolean>, timeoutMs: number, giveUp?: () => void): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > deadline) {
      giveUp?.();
      return false;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

/** Whether the process is reaped: `kill(pid, 0)` answers ESRCH once it is. */
async function exited(pid: number): Promise<boolean> {
  return new Promise((done) => {
    try {
      process.kill(pid, 0);
      done(false);
    } catch {
      done(true);
    }
  });
}

/**
 * The board's address on a given runtime, for a page to open.
 *
 * These tests are pointed at a server of their own, so their addresses are absolute and
 * never relative to the suite's `baseURL`: a test that reopened a board on the wrong
 * runtime would read a board that has nothing on it and call that a lost board.
 */
export function boardUrl(runtime: RunningRuntime, boardId: string): string {
  return `${runtime.url}/b/${boardId}`;
}

/** The address of one of a board's test-only routes, on a given runtime. */
export function hookUrl(runtime: RunningRuntime, boardId: string, route: string): string {
  return `${runtime.url}/__test/boards/${boardId}/${route}`;
}
