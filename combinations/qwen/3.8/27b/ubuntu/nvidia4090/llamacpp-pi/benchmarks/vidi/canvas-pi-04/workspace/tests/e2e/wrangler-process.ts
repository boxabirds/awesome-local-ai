// Story 4, task 6: manage a `wrangler dev` process for the persistence e2e
// (TC-19 to TC-21, TC-24).
//
// These tests need to control the worker's process lifecycle — kill it and
// restart it against the SAME `--persist-to` directory to prove that the
// board survives a cold start (the room reloads from SQLite). A Playwright
// `webServer` cannot do that, so the spec owns the process via this helper
// and runs under its own config (no shared webServer).
//
// The dev server is started with `--var TEST_HOOKS=1` so the /__test/ routes
// (compact / corrupt-snapshot / repair / wake) are available. The production
// config never sets that variable.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

export interface WranglerProcess {
  /** Base URL, e.g. http://localhost:8842. */
  url: string;
  port: number;
  /** The `--persist-to` directory; survives kill + restart. */
  persistTo: string;
  /** (Re)start the process against the same persist-to directory. */
  start(): Promise<void>;
  /** Terminate the running process (crash simulation). */
  kill(): Promise<void>;
  /** Kill + restart, keeping the same persisted storage. */
  restart(): Promise<void>;
  /** Kill the process and remove the persist-to directory. */
  dispose(): Promise<void>;
}

/** Find a free TCP port on localhost. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('findFreePort: no port allocated'));
        return;
      }
      server.close(() => resolve(address.port));
    });
    server.on('error', (err) => reject(err));
  });
}

/** Wait until `url` answers an HTTP request (any status counts as ready). */
async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      await res.body?.cancel();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`wrangler dev at ${url} did not become ready: ${String(lastError)}`);
}

const STARTUP_TIMEOUT_MS = 180_000;

/**
 * Start `wrangler dev` on a free port, persisting Durable Object storage to a
 * fresh temp directory. Returns a handle to (re)start, kill and dispose it.
 */
export async function startWranglerProcess(): Promise<WranglerProcess> {
  const port = await findFreePort();
  const persistTo = await mkdtemp(path.join(tmpdir(), 'vidi6-e2e-'));
  const url = `http://localhost:${port}`;
  let proc: ChildProcess | null = null;

  const start = async (): Promise<void> => {
    if (proc !== null) throw new Error('already running');
    await mkdir(persistTo, { recursive: true });
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--port',
        String(port),
        '--persist-to',
        persistTo,
        '--var',
        // wrangler (4.141.0) parses --var entries as NAME:VALUE (colon), not NAME=VALUE.
        'TEST_HOOKS:1',
        '--ip',
        '127.0.0.1',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        // New process group: wrangler dev spawns a workerd grandchild that
        // would otherwise survive a SIGTERM to the CLI and keep serving the
        // old in-memory Durable Object state (breaking restart()). Killing
        // the whole group (-pid) tears the tree down.
        detached: true,
      },
    );
    proc = child;
    let output = '';
    child.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
    });
    try {
      await waitForReady(url, STARTUP_TIMEOUT_MS);
    } catch (err) {
      await killChild(child);
      proc = null;
      throw new Error(
        `wrangler dev failed to start:\n${output.slice(-4000)}\n${String(err)}`,
      );
    }
    // Surface an early crash (after the first request succeeded) on kill.
    void exited.then((code) => {
      if (code !== null && code !== 0 && proc === child) {
        // Expected when we kill it; nothing to do.
      }
    });
  };

  /** Signal every process in the child's group; ignore "no such group". */
  const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Group already gone.
    }
  };

  const groupAlive = (pid: number): boolean => {
    try {
      process.kill(-pid, 0); // signal 0 = existence check only
      return true;
    } catch {
      return false;
    }
  };

  const killChild = async (child: ChildProcess): Promise<void> => {
    const pid = child.pid;
    if (pid === undefined) return;
    signalGroup(pid, 'SIGTERM');
    const termDeadline = Date.now() + 8_000;
    while (Date.now() < termDeadline && groupAlive(pid)) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (groupAlive(pid)) {
      signalGroup(pid, 'SIGKILL');
      const killDeadline = Date.now() + 3_000;
      while (Date.now() < killDeadline && groupAlive(pid)) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };

  const kill = async (): Promise<void> => {
    const child = proc;
    proc = null;
    if (child === null) return;
    await killChild(child);
  };

  const restart = async (): Promise<void> => {
    await kill();
    await start();
  };

  const dispose = async (): Promise<void> => {
    await kill();
    await rm(persistTo, { recursive: true, force: true }).catch(() => undefined);
  };

  await start();
  return {
    url,
    port,
    persistTo,
    start,
    kill,
    restart,
    dispose,
  };
}
