import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A `wrangler dev` process this test file owns, with a `--persist-to` directory
 * that survives restarts. Story 4's persistence tests need the thing the rest of
 * the suite avoids on purpose — a server that can be stopped and started again —
 * so they run against their own process instead of the shared one Playwright's
 * config starts.
 *
 * Each start takes a *new* free port. What has to survive a restart is the
 * persist directory and the board id, never the socket, and workerd does not
 * release a just-closed port quickly enough to bind it again reliably.
 */
export interface WranglerProcess {
  /** Current origin of the app, e.g. `http://127.0.0.1:41207`. Changes on restart. */
  readonly url: string;
  /** Where state is kept; unchanged across restarts. */
  readonly persistDir: string;
  /** Stop this server and start a new one on the same directory. */
  restart(): Promise<void>;
  stop(): Promise<void>;
}

interface StartOptions {
  /** Reuse an existing persist directory (what makes a restart meaningful). */
  persistDir?: string;
  /** Worker `vars` bindings, e.g. `{ TEST_HOOKS: '1' }`. */
  vars?: Record<string, string>;
  /** Print the dev server's own output. */
  verbose?: boolean;
}

const READY_TIMEOUT_MS = 120_000;

export async function startWrangler(options: StartOptions = {}): Promise<WranglerProcess> {
  const persistDir = options.persistDir ?? mkdtempSync(join(tmpdir(), 'vidi6-persist-'));

  let child: ChildProcess | null = null;
  let origin = '';

  const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
    try {
      // A negative pid reaches the whole group: signalling only `npx` leaves
      // wrangler and workerd running behind it.
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
  };

  const spawnOnce = async (): Promise<void> => {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await freePort();
      try {
        origin = await startOn(port);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    throw new Error(`could not start a dev server: ${lastError}`);
  };

  const startOn = async (port: number): Promise<string> => {
    const url = `http://127.0.0.1:${port}`;
    const args = ['wrangler', 'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistDir];
    for (const [key, value] of Object.entries(options.vars ?? {})) {
      args.push('--var', `${key}:${value}`);
    }
    const created = spawn('npx', args, {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });
    child = created;
    if (created.stdout === null || created.stderr === null) {
      throw new Error('dev server has no output pipe');
    }
    created.stdout.setEncoding('utf8');
    created.stderr.setEncoding('utf8');
    let output = '';
    let exited: string | null = null;
    created.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (options.verbose === true) process.stdout.write(`[wrangler] ${chunk}`);
    });
    created.stderr.on('data', (chunk: string) => {
      output += chunk;
      if (options.verbose === true) process.stderr.write(`[wrangler] ${chunk}`);
    });
    created.on('exit', (code) => {
      exited = `dev server exited with code ${String(code)}`;
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (exited !== null) {
        // A port someone else had not finished releasing is the usual reason,
        // and it is worth retrying; anything else is reported with the output.
        throw new Error(
          `${exited}${output.includes('Address already in use') ? ' (port busy)' : ''}:\n${tail(output)}`,
        );
      }
      if (await served(url)) return url;
      if (Date.now() > deadline) throw new Error(`dev server did not start:\n${tail(output)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };

  const stopOnce = async (): Promise<void> => {
    const running = child;
    child = null;
    if (running === null || running.pid === undefined) return;
    const pid = running.pid;
    const exited = new Promise<boolean>((resolve) => {
      running.once('exit', () => resolve(true));
      setTimeout(() => resolve(false), 10_000).unref?.();
    });
    signalGroup(pid, 'SIGTERM');
    if (!(await exited)) {
      signalGroup(pid, 'SIGKILL');
      await exited;
    }
  };

  await spawnOnce();

  return {
    get url(): string {
      return origin;
    },
    persistDir,
    restart: async () => {
      await stopOnce();
      await spawnOnce();
    },
    stop: async () => {
      await stopOnce();
      if (options.persistDir === undefined) rmSafe(persistDir);
    },
  };
}

/** A port nothing is listening on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('could not determine a free port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

/** Answering with the app — the dev server is up, bindings and assets included. */
async function served(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function tail(output: string): string {
  return output.split('\n').slice(-25).join('\n');
}

function rmSafe(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A leftover temp directory is not worth failing a test over.
  }
}
