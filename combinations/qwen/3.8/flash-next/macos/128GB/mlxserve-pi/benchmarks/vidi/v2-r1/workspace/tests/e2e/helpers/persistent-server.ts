// A dev server that stores its Durable Object storage in a directory of the
// test's own, and can be stopped and started again over that same directory.
//
// The story these exist for is about what survives a restart, and the project's
// shared Playwright server cannot be restarted by one test: it belongs to the run
// (playwright.config.ts, `webServer`), and the other specs are still using it. So
// a persistence spec owns its server — same command, same config, one difference:
// `--persist-to`, which the shared one does not pass and which story 4's whole
// subject is about (`persist.restart`, design.md "Restart e2e").
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** How long a server is allowed to take to come up before the test gives up. */
const START_TIMEOUT_MS = 120_000;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** True while something is listening on `port`. */
async function portIsTaken(port: number): Promise<boolean> {
  const probe = net.createServer();
  const taken = await new Promise<boolean>((done) => {
    probe.once('error', () => done(true));
    probe.listen(port, '127.0.0.1', () => done(false));
  });
  await new Promise<void>((done) => probe.close(() => done()));
  return taken;
}

/**
 * A port to try to listen on. The number is picked from a range below the
 * operating system's ephemeral one rather than assigned by the OS, because an
 * assigned port is an *outbound* port too: while four browsers and a test runner
 * connect to each other, the number the OS just gave you gets used by somebody's
 * socket, and the Workers runtime then fails to bind it. That failure is still
 * handled by `start()` rather than being a failed test; this only makes it rarer.
 */
async function pickPort(): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = 40_000 + Math.floor(Math.random() * 8000);
    if (!(await portIsTaken(candidate))) return candidate;
  }
  // The OS's answer as a fallback, which is the same trick with a busier range.
  const probe = net.createServer();
  await new Promise<void>((done, fail) => {
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', done);
  });
  const address = probe.address();
  if (address === null || typeof address === 'string') throw new Error('no port was assigned');
  const port = address.port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** The runtime said it could not bind the port we just checked. */
class AddressInUse extends Error {}

const addressInUse = (log: string): boolean =>
  log.includes('Address already in use') || log.includes('EADDRINUSE');

export type StopHow = 'graceful' | 'hard';

export class PersistentServer {
  /** Where it listens. It can move (`start()`), which is why it is not readonly. */
  private port: number;
  readonly persistDir: string;
  /** Everything the server wrote to its pipes, for the failure message. */
  log = '';
  private child: ChildProcess | null = null;
  /** Test hooks, so a spec can damage and repair a board it owns. */
  readonly testHooks: boolean;

  private constructor(port: number, persistDir: string, testHooks: boolean) {
    this.port = port;
    this.persistDir = persistDir;
    this.testHooks = testHooks;
  }

  static async create(options: { testHooks?: boolean } = {}): Promise<PersistentServer> {
    const [port, persistDir] = await Promise.all([
      pickPort(),
      mkdtemp(join(tmpdir(), 'board-room-persist-')),
    ]);
    return new PersistentServer(port, persistDir, options.testHooks ?? false);
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The address of a board on this server. */
  boardUrl(boardId: string): string {
    return `${this.origin}/b/${boardId}`;
  }

  /**
   * Make a board exist at `boardId`, through the `initialize` test hook, before
   * anybody opens it. Story 5 makes a board exist only once it is created, so a
   * scenario that wants a board at a chosen address — and finds it again across a
   * restart — creates it here first.
   */
  async seedBoard(boardId: string): Promise<void> {
    const response = await fetch(
      `${this.origin}/api/rooms/${boardId}?__test=initialize`,
      { method: 'POST' },
    );
    if (!response.ok) {
      throw new Error(`could not create board ${boardId}: ${String(response.status)}`);
    }
  }

  /**
   * Arrange a board that looks like it was made before story 5: real updates and
   * no `created_at` (TC-31). `updates` are base64 Yjs updates.
   */
  async seedLegacyBoard(boardId: string, updates: string[]): Promise<void> {
    const response = await fetch(
      `${this.origin}/api/rooms/${boardId}?__test=seed-legacy`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`could not seed legacy board ${boardId}: ${body}`);
    }
  }

  /**
   * Start, and wait until it answers.
   *
   * A port that was free when it was chosen can be taken by the time the runtime
   * binds it — see `pickPort` — so that one failure is retried somewhere else
   * instead of being reported as a board that would not load.
   */
  async start(): Promise<void> {
    if (this.child !== null) throw new Error('this server is already running');
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await this.startOnce();
        return;
      } catch (error) {
        if (!(error instanceof AddressInUse) || attempt === 3) throw error;
        this.port = await pickPort();
      }
    }
  }

  private async startOnce(): Promise<void> {
    const child = spawn(
      process.execPath,
      [
        join(repoRoot, 'node_modules', '.bin', 'wrangler'),
        'dev',
        '--config',
        'wrangler.jsonc',
        '--persist-to',
        this.persistDir,
        '--ip',
        '127.0.0.1',
        '--port',
        String(this.port),
        // The story 4 hooks, and `--var` is the only way to say it: a Worker's
        // `env` in local development is built from the configuration and these
        // pairs, and *not* from the environment of whoever ran wrangler. Verified
        // the hard way — with the variable only in the shell, the hook route
        // answers as if the flag were off, which is the right answer for a
        // production Worker and a confusing one for a test.
        ...(this.testHooks ? ['--var', 'TEST_HOOKS:1'] : []),
      ],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so stopping it stops the runtime it started too:
        // a leftover workerd holding the port or the storage file is exactly the
        // thing a restart test must not have.
        detached: process.platform !== 'win32',
      },
    );
    this.child = child;
    child.stdout?.on('data', (chunk: Buffer) => {
      this.log += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.log += chunk.toString();
    });
    child.on('error', (error) => {
      this.log += `spawn error: ${String(error)}\n`;
    });

    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (child.exitCode !== null) {
        const failure = addressInUse(this.log)
          ? new AddressInUse(`port ${String(this.port)} was taken while the server was starting`)
          : new Error(`the server exited before it was ready (${String(child.exitCode)}):\n${this.log}`);
        this.child = null;
        void child.kill('SIGKILL');
        throw failure;
      }
      try {
        const response = await fetch(`${this.origin}/`);
        if (response.ok) return;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline) throw new Error(`the server did not come up:\n${this.log}`);
      await sleep(200);
    }
  }

  /**
   * Stop the server. `graceful` is a signal the process can react to; `hard` is
   * SIGKILL, which it cannot — the difference matters for a board that was in the
   * middle of something, and the PRD asks for it not to matter.
   */
  async stop(how: StopHow = 'graceful'): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child !== null && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      const signal = how === 'hard' ? 'SIGKILL' : 'SIGTERM';
      // A process killed by a signal reports `signalCode`, not `exitCode`, so this
      // waits for the event rather than for a code that a SIGKILL never leaves.
      const gone = new Promise<'gone'>((done) => {
        child.once('exit', () => done('gone'));
      });
      const stuck = new Promise<'stuck'>((done) => {
        const timer = setTimeout(() => done('stuck'), 15_000);
        timer.unref();
      });
      try {
        // Negative pid: the whole process group, the runtime it started included.
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
      if ((await Promise.race([gone, stuck])) !== 'gone') {
        child.kill('SIGKILL');
        throw new Error(`the server would not stop (${how}):\n${this.log}`);
      }
    }
    // The port has to be free again before a restart can listen on it, and "free"
    // has to mean *no process holds it*: `wrangler dev` starts the Workers runtime
    // as a child of its own, and when the parent is killed the child can hold the
    // listener for a second or two — long enough for a probe to bind, and short
    // enough that the new runtime then fails with EADDRINUSE. So: ask who holds
    // it, and stop them holding it.
    const deadline = Date.now() + 30_000;
    for (;;) {
      const holders = await pidsHoldingPort(this.port);
      if (holders.length === 0) break;
      if (Date.now() > deadline) {
        throw new Error(
          `port ${String(this.port)} is still held by ${holders.join(', ')} after the server stopped:\n${this.log}`,
        );
      }
      for (const pid of holders) {
        try {
          // The runtime that outlived its parent gets the ending its parent had.
          process.kill(pid, 'SIGKILL');
        } catch {
          // It went away between the listing and the signal, which is the outcome.
        }
      }
      await sleep(150);
    }
  }

  /** Stop and come back over the same directory: the restart of TC-19 and TC-20. */
  async restart(how: StopHow = 'graceful'): Promise<void> {
    await this.stop(how);
    await this.start();
  }

  /** Give the directory back. Call it even when a test failed. */
  async cleanup(): Promise<void> {
    await this.stop('hard');
    rmSync(this.persistDir, { recursive: true, force: true });
  }
}

/**
 * The process ids holding a TCP port. `lsof` is POSIX, and it is the only
 * dependable answer here — see the note in `stop()`. On a platform without it,
 * this says "nobody", and the wait falls back to the port probe.
 */
function pidsHoldingPort(port: number): Promise<number[]> {
  if (process.platform === 'win32') return Promise.resolve([]);
  return new Promise((done) => {
    execFile('lsof', ['-nP', '-ti', `tcp:${String(port)}`], (error, out) => {
      done(
        error
          ? []
          : out
            .split('\n')
            .map((line) => Number(line.trim()))
            .filter((pid) => Number.isInteger(pid) && pid > 0),
      );
    });
  });
}
