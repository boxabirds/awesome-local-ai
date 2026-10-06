/**
 * A `wrangler dev` that a test owns: started, stopped, and started again somewhere else with
 * the same storage on disk.
 *
 * Story 4's promise is about the space between two runs of the server, and there is only one
 * honest way to test that space — leave it. The suite's shared `wrangler dev` is no use here:
 * it never stops, so nothing is ever forgotten, and a test that wants "the process that had
 * this board is gone" cannot ask a process that has been up the whole time not to remember
 * something. So these tests start their own, point it at a directory of their own, and stop it.
 *
 * Two things about ports, both learned the hard way.
 *
 * They are chosen free rather than fixed. A fixed pair is a promise about a machine that
 * nothing can keep — another `wrangler dev` already running, or a test that timed out and left
 * its server behind — and a second server that cannot bind a port does not say "port in use"
 * where a test can read it, it simply is not there. So each server asks for a port, gets one
 * nobody is listening on, and the *pair* the design asks for is the same thing with the port
 * left out: a restarted server is a different process on a different port, and the only thing
 * the two have in common is the files.
 *
 * And every probe of a port has a timeout, because in the sandbox these tests run in a
 * connection to a port where nothing listens does not get refused — it waits. A readiness
 * check that waits for an answer that is never coming is a test that spends its whole timeout
 * without ever saying what it was waiting for.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/** How long a server gets to answer its first request. */
const READY_TIMEOUT_MS = 240_000;
/** How long a stopped server gets to let go of its port. */
const STOP_TIMEOUT_MS = 30_000;
/** How long one look at a port takes before it is called unanswered. */
const PROBE_TIMEOUT_MS = 2000;

/** One running server. */
export interface RoomServer {
  /** The port it answers on. */
  readonly port: number;
  /** `http://127.0.0.1:<port>` — for the browser and for `fetch`. */
  readonly origin: string;
  /** `ws://127.0.0.1:<port>` — for a client that speaks the room protocol itself. */
  readonly wsOrigin: string;
  /** Where its storage lives, which is the one thing a restart keeps. */
  readonly persistTo: string;
  /** The address a browser is sent to in order to open a board. */
  boardAddress(boardId: string): string;
  /** The address a storage hook is posted to. */
  hookAddress(boardId: string, action: string): string;
  /** Stops the server and waits until its port is shut. */
  stop(): Promise<void>;
}

/** Where these servers' Durable Object storage lives. */
export function persistenceDir(name: string): string {
  return resolve(process.cwd(), '.test-durable', name);
}

/**
 * Clears a directory of the boards an earlier run left, and of the record of the process that
 * was serving them — which is stopped first, because a server holding a directory open is not
 * a directory that starts empty.
 */
export async function resetPersistenceDir(dir: string): Promise<void> {
  await killRecordedProcess(dir);
  rmSync(dir, { recursive: true, force: true });
}

interface StartOptions {
  /** The directory this server's storage lives in — the same one, to remember anything. */
  persistTo: string;
  /** Whether the storage-damaging endpoints are switched on. Test builds, never production. */
  testHooks?: boolean;
  /** A port to insist on. Normally nobody: one is chosen free. */
  port?: number;
}

/** Starts a server and waits until it serves the board. */
export async function startRoomServer({
  persistTo,
  testHooks = false,
  port,
}: StartOptions): Promise<RoomServer> {
  const chosen = port ?? (await freePort());
  const inspector = await freePort();
  const args = [
    resolve(process.cwd(), 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev',
    '--local',
    '--ip',
    '127.0.0.1',
    '--port',
    String(chosen),
    '--inspector-port',
    String(inspector),
    '--persist-to',
    persistTo,
    ...(testHooks ? ['--var', 'TEST_HOOKS:1'] : []),
  ];

  const logs: string[] = [];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    // Its own process group, so the whole of it goes when the test is done with it.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  });
  const collect = (chunk: Buffer): void => {
    logs.push(chunk.toString());
    if (logs.length > 400) logs.splice(0, logs.length - 400);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  if (child.pid !== undefined) await recordProcess(persistTo, child.pid);

  const exited = new Promise<'exited'>((resolveExit) => {
    child.on('exit', () => resolveExit('exited'));
  });

  const origin = `http://127.0.0.1:${chosen}`;
  try {
    await waitFor(() => portOpen(chosen), READY_TIMEOUT_MS);
  } catch {
    // A server that never answered is worth reading, not guessing at.
    throw new Error(`wrangler dev on port ${chosen} never answered.\n${logs.join('')}`);
  }

  let stopped = false;
  return {
    port: chosen,
    origin,
    wsOrigin: `ws://127.0.0.1:${chosen}`,
    persistTo,
    boardAddress: (boardId) => `${origin}/b/${boardId}`,
    hookAddress: (boardId, action) => `${origin}/__test/boards/${boardId}/${action}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (child.pid !== undefined && child.exitCode === null) {
        signal(child.pid, 'SIGTERM');
        // However it goes, it has to have gone: the port being shut is the only proof that
        // what comes next is a *new* server and not the old one, still holding the board in
        // the memory the test was supposed to have destroyed.
        if ((await race([exited, after(STOP_TIMEOUT_MS)])) === 'timeout') signal(child.pid, 'SIGKILL');
      }
      await waitFor(async () => !(await portOpen(chosen)), STOP_TIMEOUT_MS);
    },
  };
}

/**
 * Stops a server and starts another in its place, against the same directory on disk: the
 * restart case, with nothing in common with the old process but files.
 */
export async function restartRoomServer(
  server: RoomServer,
  persistTo = server.persistTo,
): Promise<RoomServer> {
  await server.stop();
  return startRoomServer({ persistTo, testHooks: true });
}

/**
 * A port nobody is listening on.
 *
 * Bound and released to ask the operating system, which is the only thing that knows. There is
 * a moment between letting go and handing it to wrangler in which somebody else could take it;
 * if that happens the server below never answers, and the failure says so with the server's own
 * output rather than pretending.
 */
export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  await new Promise<void>((resolveClose) => {
    server.close(() => resolveClose());
  });
  return port;
}

/** Is anything listening? */
function portOpen(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then((response) => response.ok)
    .catch(() => false);
}

async function waitFor(ready: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > until) throw new Error(`timed out after ${timeoutMs}ms`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

function after(ms: number): Promise<'timeout'> {
  return new Promise((resolveAfter) => {
    const timer = setTimeout(() => resolveAfter('timeout'), ms);
    timer.unref?.();
  });
}

function race<T>(promises: Promise<T>[]): Promise<T> {
  return Promise.race(promises);
}

/** Sends a signal to a process group, and does not make a scene if it is already gone. */
function signal(pid: number, signalToSend: NodeJS.Signals): void {
  try {
    process.kill(-pid, signalToSend);
  } catch {
    try {
      process.kill(pid, signalToSend);
    } catch {
      /* already gone */
    }
  }
}

const PID_FILE = '.wrangler-pid';

/**
 * Remembers which process is serving a directory, so the next run can stop it. A test that
 * timed out left its server alive, and a server alive on a directory is a directory that
 * remembers the boards the next test was going to assume it had never had.
 */
async function recordProcess(dir: string, pid: number): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, PID_FILE), `${pid}\n`, 'utf8');
}

/** Stops whatever an earlier run left serving this directory, if anything. */
async function killRecordedProcess(dir: string): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  let pid: number;
  try {
    pid = Number((await readFile(resolve(dir, PID_FILE), 'utf8')).trim());
  } catch {
    return; // nothing recorded, nothing to stop
  }
  if (!Number.isInteger(pid) || pid <= 0) return;
  signal(pid, 'SIGKILL');
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
}
