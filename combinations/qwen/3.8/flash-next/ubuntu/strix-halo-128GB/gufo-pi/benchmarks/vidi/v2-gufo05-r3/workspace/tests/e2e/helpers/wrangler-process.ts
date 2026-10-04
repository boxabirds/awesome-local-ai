/**
 * A `wrangler dev` process that a test owns (story 4, task 6).
 *
 * The persistence story cannot be proved inside one long-lived server: the claim
 * is that a board outlives the process that was holding it. So a test starts a dev
 * server on its own ports with its own storage directory on disk, and stops that
 * process while the test runs — the closest thing available to the platform
 * evicting a Durable Object, or to the machine being switched off and back on.
 *
 * `restart()` keeps the storage directory and loses everything else, which is
 * exactly the difference the story is about.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = '127.0.0.1';
/** `wrangler dev` compiles the worker and the assets on first start. */
const READY_TIMEOUT_MS = 180_000;
const KILL_GRACE_MS = 5_000;

async function assertPortIsFree(port: number): Promise<void> {
  try {
    const response = await fetch(`http://${HOST}:${port}/`);
    throw new Error(
      `port ${port} is already answered by something (${response.status}) — stop the ` +
        'leftover dev server before running the persistence tests',
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('port ')) throw error;
    /* nothing listening: what we want */
  }
}

export interface StartOptions {
  port: number;
  inspectorPort: number;
  /** `'1'` enables the worker's test-only routes; anything else leaves them off. */
  testHooks?: '1';
}

export interface WranglerServer {
  /** Origin of this server, e.g. `http://127.0.0.1:23624`. */
  readonly url: string;
  /** The directory its storage lives in, kept across restarts. */
  readonly persistDir: string;
  /**
   * Stop the process. Storage is left where it is. `SIGKILL` is the abrupt
   * version: no chance to clean anything up, which is what "the process died"
   * means to a board.
   */
  stop(signal?: 'SIGTERM' | 'SIGKILL'): Promise<void>;
  /** Stop and start again over the same storage: memory gone, board not. */
  restart(): Promise<void>;
  /** Stop and delete the storage: a board that never was. */
  dispose(): Promise<void>;
}

export async function startWrangler(options: StartOptions): Promise<WranglerServer> {
  const persistDir = mkdtempSync(join(tmpdir(), 'vidi6-persist-'));
  // Fail here rather than later: a server left behind by an interrupted run answers
  // on this port with a storage directory nobody knows about, and every assertion
  // below would then be about the wrong board.
  await assertPortIsFree(options.port);
  const server: WranglerServer = {
    url: `http://${HOST}:${options.port}`,
    persistDir,
    stop,
    restart,
    dispose,
  };

  let child: ChildProcess | null = null;

  function args(): string[] {
    return [
      'dev',
      '--ip',
      HOST,
      '--port',
      String(options.port),
      '--inspector-port',
      String(options.inspectorPort),
      '--persist-to',
      persistDir,
      '--log-level',
      'warn',
      ...(options.testHooks === '1' ? ['--var', 'TEST_HOOKS:1'] : []),
    ];
  }

  /**
   * `detached` puts wrangler (and the runtime it starts) in their own process
   * group, so one signal stops the whole tree instead of leaving workerd behind
   * holding the ports.
   */
  function spawnProcess(): Promise<ChildProcess> {
    return new Promise((resolveSpawn, rejectSpawn) => {
      const proc = spawn(join(process.cwd(), 'node_modules', '.bin', 'wrangler'), args(), {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      const noise: string[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => noise.push(chunk.toString()));
      proc.stderr?.on('data', (chunk: Buffer) => noise.push(chunk.toString()));
      proc.once('error', rejectSpawn);
      proc.once('exit', (code) => {
        if (noise.length > 0) process.stderr.write(`[wrangler:${options.port}] ${noise.join('')}`);
        rejectSpawn(new Error(`wrangler dev exited with code ${code} before it was ready`));
      });
      // Readiness: the worker answers HTTP, which means assets and routes are up.
      const deadline = Date.now() + READY_TIMEOUT_MS;
      const poll = async (): Promise<void> => {
        try {
          const response = await fetch(`${server.url}/`);
          if (response.ok) {
            proc.removeAllListeners('exit');
            proc.removeAllListeners('error');
            resolveSpawn(proc);
            return;
          }
        } catch {
          /* not listening yet */
        }
        if (Date.now() > deadline) {
          proc.kill('SIGKILL');
          rejectSpawn(new Error(`wrangler dev did not answer on ${server.url} in time`));
          return;
        }
        setTimeout(poll, 500);
      };
      void poll();
    });
  }

  async function stop(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<void> {
    const proc = child;
    child = null;
    const pid = proc?.pid;
    if (proc === null || pid === undefined) return;
    await new Promise<void>((resolveStop) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(killer);
        resolveStop();
      };
      proc.once('exit', finish);
      try {
        process.kill(-pid, signal);
      } catch {
        finish();
        return;
      }
      const killer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
        // The group leader may already have exited; do not wait for a signal that
        // will not come again.
        setTimeout(finish, 1_000);
      }, signal === 'SIGKILL' ? 200 : KILL_GRACE_MS);
    });
  }

  async function restart(): Promise<void> {
    await stop();
    child = await spawnProcess();
  }

  async function dispose(): Promise<void> {
    await stop();
    rmSync(persistDir, { recursive: true, force: true });
  }

  child = await spawnProcess();
  return server;
}

/** Ports for the persistence project, inside the allowed range. */
export const PERSISTENCE_PORT = Number(process.env.E2E_PERSIST_PORT ?? 23624);
export const PERSISTENCE_INSPECTOR_PORT = Number(process.env.E2E_PERSIST_INSPECTOR_PORT ?? 23625);
