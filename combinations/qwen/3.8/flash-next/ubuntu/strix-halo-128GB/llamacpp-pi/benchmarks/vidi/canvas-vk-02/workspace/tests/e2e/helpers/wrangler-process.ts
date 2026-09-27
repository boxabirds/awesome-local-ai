/**
 * tests/e2e/helpers/wrangler-process.ts
 *
 * A `wrangler dev` process a test owns: its own port, its own directory of
 * durable state, and it can be stopped and started again — which is the only
 * honest way to test persistence. The shared dev server that the other e2e
 * projects use cannot do it: killing that would take the rest of the suite with
 * it, and its state directory is whatever the last run left.
 *
 * The directory is what makes the test worth having. `wrangler dev` keeps the
 * Durable Objects' SQLite there, so a restarted server is a server that has
 * forgotten everything in its memory and still has the board — the exact
 * situation story 4 is about, and one no in-process fake can produce.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

export interface DevServer {
  /** `http://127.0.0.1:<port>`, ready to be a Playwright base URL. */
  readonly url: string;
  /** Where this server's Durable Object storage lives. */
  readonly persistDir: string;
  /** The address a board's room is reached on. */
  roomUrl(boardId: string): string;
  /** Stop the server and wait for the port to be released. */
  stop(options?: { hard?: boolean }): Promise<void>;
  /**
   * Stop and come back over the same storage: same port, same directory, new
   * process, no memory of the board it was serving.
   */
  restart(): Promise<void>;
}

/** The client has to be built once per run; every server here serves it. */
let clientBuilt = false;

export async function startDevServer(): Promise<DevServer> {
  const port = await freePort();
  const persistDir = await mkdtemp(join(tmpdir(), 'vidi6-persist-'));
  let child: ChildProcess | null = null;

  const server: DevServer = {
    url: `http://127.0.0.1:${String(port)}`,
    persistDir,
    roomUrl: (boardId: string) =>
      `ws://127.0.0.1:${String(port)}/api/rooms/${boardId}`,
    stop: (options) => stopChild(child, options),
    restart: async () => {
      await stopChild(child, { hard: true });
      child = await launch(port, persistDir);
    },
  };

  child = await launch(port, persistDir);
  return server;
}

/**
 * The child is started in its own process group because `wrangler dev` is a
 * wrapper: killing only the wrapper leaves `workerd` holding the port, and the
 * next server then serves a board nobody can reach. Killing the group is what
 * "the process died" actually means to the operating system.
 */
async function launch(port: number, persistDir: string): Promise<ChildProcess> {
  if (!clientBuilt) {
    // The e2e build is the one with `window.__vidi6`; the servers here serve the
    // same `dist/client` the shared dev server does.
    await new Promise<void>((resolve, reject) => {
      const build = spawn('npm', ['run', 'build:test'], { stdio: 'ignore' });
      build.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`client build failed with ${String(code)}`)),
      );
    });
    clientBuilt = true;
  }

  const child = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--persist-to',
      persistDir,
      '--log-level',
      'warn',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: process.env },
  );

  // Nobody reads the pipe in a passing run, and an unread pipe eventually stops
  // the child; keep the bytes and let a failure print them.
  const noise: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => noise.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => noise.push(chunk.toString()));
  child.on('exit', (code) => {
    if (code !== null && code !== 0 && noise.join('').includes('in use')) {
      console.error(`wrangler dev on port ${String(port)} failed: ${noise.join('')}`);
    }
  });

  await waitForServer(`http://127.0.0.1:${String(port)}/`, child, noise);
  return child;
}

async function stopChild(child: ChildProcess | null, options?: { hard?: boolean }): Promise<void> {
  if (child === null || child.exitCode !== null) return;
  const pid = child.pid;
  if (pid === undefined) return;
  const signal = options?.hard === true ? 'SIGKILL' : 'SIGTERM';
  // The minus sign is the process group, which is why `detached` is set above.
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    child.on('exit', done);
    child.on('close', done);
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      done();
    }, 5_000).unref();
  });
}

/** Poll until the server answers anything, or until it is clear it never will. */
async function waitForServer(url: string, child: ChildProcess, noise: string[]): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError = 'not attempted';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited with ${String(child.exitCode)}: ${noise.join('').slice(-2_000)}`);
    }
    try {
      const response = await fetch(url);
      // Any answer at all means the worker is up: the SPA answers 200.
      if (response.status < 500) return;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler dev did not become ready (${lastError}): ${noise.join('').slice(-2_000)}`);
}

/** A port nothing is listening on, asked of the operating system. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      const port = address.port;
      probe.close(() => resolve(port));
    });
  });
}
