/**
 * Story 4 · task 6 helper — a real `wrangler dev` process per test.
 *
 * The point of TC-19/TC-20 is that a board survives the *process* forgetting
 * everything: the Durable Object is destroyed, its in-memory Y.Doc with it, and
 * the next visitor only gets their board back if it was written to SQLite on
 * disk. Nothing shorter than a real restart proves that, so this file starts
 * and stops an actual server instead of sharing Playwright's `webServer`.
 *
 * Two choices worth explaining:
 *
 *  - Each process gets its own `--persist-to` directory. State never leaks
 *    between tests, and a run never reads the leftover database of the last one
 *    (which would turn "did it persist?" into "did it cache?").
 *  - Ports come from the operating system, and readiness additionally requires
 *    the child itself to report that it is listening on that port. Playwright
 *    runs the three browser projects at the same time, so a fixed port would be
 *    claimed by whichever browser got there first; the others would then talk to
 *    a *foreign* server — one with a different state directory — and read back
 *    an empty board that nothing had ever been written to. Ownership is
 *    therefore checked, not assumed.
 *  - Stopping is `SIGKILL` to the whole process group. `npx` wraps the real
 *    workerd child, so killing only `npx` would leave the server behind; a hard
 *    kill is also the honest version of "the process died".
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root: `wrangler dev` resolves `wrangler.jsonc` from here. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface BoardProcess {
  /** Origin of the running server, e.g. `http://127.0.0.1:57891`. */
  url: string;
  /** The port the OS handed out (needed when a restart picks another one). */
  port: number;
  /** Where its SQLite state lives (reuse to restart on the same board data). */
  persistTo: string;
  /** Hard-stop the process group; resolves once it is really gone. */
  stop(): Promise<void>;
  /** Delete the state directory (call it after the last restart). */
  removeState(): void;
}

export interface StartOptions {
  /** Omit to let the OS pick a free port — the default, and what specs use. */
  port?: number;
  /** Reuse a directory to restart a server over the same stored boards. */
  persistTo?: string;
  /** Extra `wrangler dev` arguments (tests do not need any today). */
  args?: string[];
}

const READY_TIMEOUT_MS = 120_000;

/**
 * Ask the operating system for a port that is free at this instant. A connect
 * to `port 0` makes it allocate one, and closing the probe socket releases it
 * again; the race window that leaves is closed by the ownership check below.
 */
async function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (typeof address !== 'object' || address === null) {
        probe.close();
        reject(new Error('could not allocate a port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Wait until *this* child is serving. Both signals are required: the child's
 * own stdout line naming the port (proof it bound it — a lost race shows up as
 * "Address already in use" and fails immediately) and an actual HTTP answer,
 * which also proves the worker and its assets are up, not just the socket.
 */
async function waitForReady(
  child: ChildProcess,
  url: string,
  port: number,
  logs: () => string,
): Promise<void> {
  // Host-agnostic on purpose: `--ip 127.0.0.1` makes wrangler announce
  // `Ready on http://127.0.0.1:PORT`, while a default run says `localhost`.
  const listening = new RegExp(`Ready on \\S*:${port}\\b`);
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const output = logs();
    if (output.includes('Address already in use')) {
      throw new Error(`port ${port} was already taken by another process\n${output.slice(-600)}`);
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`wrangler exited before it was ready\n${output.slice(-600)}`);
    }
    if (listening.test(output)) {
      try {
        const response = await fetch(`${url}/`, { signal: AbortSignal.timeout(2_000) });
        if (response.status === 200) return;
      } catch {
        // Listening but not serving yet; the next loop round will retry.
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `wrangler did not become ready on ${url} (last output below)\n${logs().slice(-600)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Start one `wrangler dev` on a free port and wait for it to serve.
 *
 * A port the OS handed out a moment ago can be taken again before workerd
 * binds it (three browser projects × nine workers all spawn servers here), so
 * a collision is retried on a freshly reserved port instead of failing the
 * test: the race is with the machine, not with the feature under test.
 */
export async function startBoardProcess(options: StartOptions = {}): Promise<BoardProcess> {
  const persistTo = options.persistTo ?? mkdtempSync(join(tmpdir(), 'vidi6-board-'));
  const attempts = options.port === undefined ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = options.port ?? (await reserveFreePort());
    try {
      return await startOnPort(port, persistTo, options.args ?? []);
    } catch (error) {
      lastError = error;
      if (!isPortRace(error)) throw error;
    }
  }
  throw lastError;
}

/** True when the failure was "the port was busy", i.e. safe to retry. */
function isPortRace(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('already taken by another process');
}

async function startOnPort(
  port: number,
  persistTo: string,
  extraArgs: string[],
): Promise<BoardProcess> {
  const argv = [
    'wrangler',
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    persistTo,
    ...extraArgs,
  ];

  const url = `http://127.0.0.1:${port}`;
  const child = spawn('npx', argv, {
    cwd: ROOT,
    // Its own process group, so `stop` can take workerd down with the wrapper.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const tail = () => output;

  try {
    await waitForReady(child, url, port, tail);
  } catch (error) {
    await kill(child);
    throw error;
  }

  return {
    url,
    port,
    persistTo,
    stop: async () => {
      await kill(child);
    },
    removeState: () => {
      rmSync(persistTo, { recursive: true, force: true });
    },
  };
}

/**
 * The SQLite files the server has created under its state directory. Used to
 * check that a restart really reopens the same database: if the Durable Object
 * kept a board only in memory there would be no file to read back.
 */
export function listStateFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.includes('.sqlite'))
    .map((name) => name.split('/').slice(-2).join('/'))
    .sort();
}

/** Signal the whole group and wait (bounded) for the process to disappear. */
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.once('close', () => resolve());
  });
  try {
    if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
    else child.kill('SIGKILL');
  } catch {
    // Already gone.
  }
  await Promise.race([
    gone,
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

/**
 * Measure from navigation until the whole board is on screen.
 *
 * `count` is the number of note elements the page has rendered; the client
 * renders every note in the document, so this is the honest end-to-end
 * "board open" measure: WebSocket connect, sync, apply and paint.
 */
export async function waitForRenderedNotes(
  page: import('@playwright/test').Page,
  count: number,
  timeoutMs: number,
): Promise<number> {
  try {
    await page.waitForFunction(
      (wanted) => document.querySelectorAll('[data-testid="sticky-display"]').length >= wanted,
      count,
      { timeout: timeoutMs },
    );
  } catch {
    // Reported by the caller, which prints what was actually rendered.
  }
  return page.evaluate(
    () => document.querySelectorAll('[data-testid="sticky-display"]').length,
  );
}
