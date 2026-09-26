// Address helpers for integration tests. Each test FILE boots its own
// `wrangler dev` on a dedicated port so files can run in parallel and one
// file can restart its server mid-suite without affecting others.
//
// Two entry points:
//   * `startServer`  — reuse a healthy server on the port if there is one
//     (fast local runs), otherwise spawn one.
//   * `startFreshServer` — KILL whatever holds the port and wipe its storage
//     directory first. Tests that assert on durability across a restart must
//     use this, otherwise "restart" silently reuses the same process and
//     proves nothing.

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_PORT = 8790;
export const HTTP_ORIGIN = `http://127.0.0.1:${DEFAULT_PORT}`;
export const WS_ORIGIN = `ws://127.0.0.1:${DEFAULT_PORT}`;

export interface DevServer {
  port: number;
  /** Storage directory the server writes to — deliberately reused across a
   * restart, so "the data survived" means it came off disk. */
  storageDir: string;
  httpOrigin: string;
  wsOrigin: string;
  proc: ChildProcess | null;
  /** True when this suite spawned (and therefore owns) the process. */
  owned: boolean;
  stop(): Promise<void>;
}

const WORKERD = new URL('../../../node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd', import.meta.url).pathname;

async function healthy(port: number): Promise<boolean> {
  try {
    // A malformed board id answers 404 as soon as the worker answers at all
    // (story 5: unknown AND malformed ids are 404, nothing leaks).
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms/not-valid`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status === 404;
  } catch {
    return false;
  }
}

/** PIDs LISTENING on `port`. Only listeners may be killed: a plain
 * `lsof -ti tcp:<port>` also lists our own test process while it holds a
 * pooled client connection to a previous server, and killing that takes the
 * whole run down. */
function pidsOnPort(port: number): string[] {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((pid) => pid.length > 0 && Number(pid) !== process.pid);
  } catch {
    return [];
  }
}

/** Kill everything bound to `port` and wait until the port is actually free —
 * spawning a replacement too early makes workerd exit with "Address already
 * in use", which looks like a code failure but is a race. */
async function freePort(port: number, timeoutMs = 10_000): Promise<void> {
  for (const pid of pidsOnPort(port)) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (pidsOnPort(port).length > 0 && Date.now() < deadline) {
    await sleep(100);
  }
  await sleep(200);
}

export function persistDir(port: number): string {
  return `/tmp/vidi-it-${port}`;
}

/** A port nothing is listening on. A restart deliberately moves to a NEW port
 * (same storage directory): re-binding the old number races the dying workerd,
 * which then exits with "Address already in use" and looks like a code failure. */
function pickFreePort(start: number, tries = 40): number {
  for (let port = start; port < start + tries; port += 1) {
    if (pidsOnPort(port).length === 0) return port;
  }
  throw new Error(`no free port at or above ${start}`);
}

/** Spawn `wrangler dev` on `port` (or reuse a healthy one) and wait for it. */
export async function startServer(port: number): Promise<DevServer> {
  if (await healthy(port)) return wrap(port, persistDir(port), null, false);
  return spawnServer(port, persistDir(port));
}

/** Always a NEW process with EMPTY storage (durability tests). */
export async function startFreshServer(port: number): Promise<DevServer> {
  await freePort(port);
  rmSync(persistDir(port), { recursive: true, force: true });
  // The storage directory stays tied to the requested port even if the server
  // ends up on a neighbour, so a restart can reuse it.
  return spawnServer(pickFreePort(port), persistDir(port));
}

async function spawnServer(port: number, storageDir: string): Promise<DevServer> {
  const proc = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--config',
      'wrangler.jsonc',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      // Unique DO/queue storage per instance so parallel dev servers never
      // fight over one persist dir (sharing it makes workerd exit early).
      '--persist-to',
      storageDir,
      // Storage test hooks (see src/worker/test-hooks.ts): the integration
      // suite drives real storage states through /__test/rooms/:id/*. A
      // production deploy never passes this, and then the routes do not exist.
      '--var',
      'TEST_HOOKS:1',
    ],
    {
      cwd: new URL('../../../', import.meta.url).pathname,
      env: { ...process.env, CI: '1', MINIFLARE_WORKERD_PATH: WORKERD },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let tail = '';
  const capture = (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-4000);
  };
  proc.stdout?.on('data', capture);
  proc.stderr?.on('data', capture);
  const deadline = Date.now() + 60_000;
  while (!(await healthy(port))) {
    if (proc.exitCode !== null) {
      throw new Error(`wrangler dev exited early on port ${port}:\n${tail}`);
    }
    if (Date.now() > deadline) throw new Error(`wrangler dev not ready on port ${port}:
${tail}`);
    await sleep(250);
  }
  return wrap(port, storageDir, proc, true);
}

function wrap(port: number, storageDir: string, proc: ChildProcess | null, owned: boolean): DevServer {
  return {
    port,
    storageDir,
    httpOrigin: `http://127.0.0.1:${port}`,
    wsOrigin: `ws://127.0.0.1:${port}`,
    proc: proc ?? null,
    owned,
    async stop() {
      if (proc === null) return;
      proc.kill('SIGKILL');
      await sleep(400);
    },
  };
}

/** Kill the current process and spawn a NEW one over the SAME storage
 * directory on a different port: a genuine process restart, which is the only
 * way to prove the board comes from disk rather than from memory. */
export async function restartServer(server: DevServer): Promise<DevServer> {
  await server.stop();
  const port = pickFreePort(server.port + 100);
  return spawnServer(port, server.storageDir);
}
