/**
 * A `wrangler dev` that a test can switch off and bring back.
 *
 * The shared e2E web server is fine until a test needs the *process* to go away —
 * which is what story 4 is about: "return to a board and find everything as it was
 * left" is only proved when nothing is left in memory. These tests therefore own a
 * server of their own, on their own port, writing to a `--persist-to` directory of
 * their own, and stop it with `SIGKILL`: no graceful shutdown, no chance that
 * something was flushed on the way out. Starting it again over the same directory is
 * the closest thing to restarting the product that a test can do.
 *
 * The build is not repeated per server — the shared web server has already produced
 * `dist/client`, and both instances serve it.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { execPath } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

/** One running `wrangler dev`, and the way to stop it. */
export interface BoardServer {
  /** e.g. `http://127.0.0.1:21332`. */
  readonly origin: string;
  /** Where its Durable Object storage lives. */
  readonly persistTo: string;
  /** `SIGKILL` by default: the point is that memory is gone, not politely flushed. */
  stop(options?: { graceful?: boolean }): Promise<void>;
}

export interface ServerOptions {
  persistTo: string;
  port: number;
  inspectorPort: number;
  /** How long to wait for the dev server to answer. */
  readyTimeoutMs?: number;
}

/** How long a dev server gets to answer before the test gives up on it. */
const READY_TIMEOUT_MS = 180_000;

/**
 * Start `wrangler dev` and wait until it serves.
 *
 * The child runs in its own process group so `stop` can take the whole thing down:
 * wrangler supervises a worker runtime of its own, and killing only the parent would
 * leave a server that still answers on the port — which would make a "the process
 * died" test quietly test nothing.
 */
export async function startBoardServer(options: ServerOptions): Promise<BoardServer> {
  const { persistTo, port, inspectorPort } = options;
  const origin = `http://127.0.0.1:${port}`;
  const stderr: string[] = [];

  // Worth saying plainly: without a client build the board serves an empty page, and a
  // test would report that the notes had gone missing.
  await assertClientBuildIsThere();

  const child = spawn(
    execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      persistTo,
      '--show-interactive-dev-session=false'
    ],
    {
      cwd: repoRoot(),
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }
    }
  );

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));

  let stopped = false;
  const failure = new Promise<never>((_resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (!stopped) reject(new Error(`wrangler dev exited early (${code ?? signal}): ${tail(stderr)}`));
    });
    child.on('error', (error) => reject(new Error(`could not start wrangler dev: ${error.message}`)));
  });

  try {
    await Promise.race([waitForReady(origin, options.readyTimeoutMs ?? READY_TIMEOUT_MS), failure]);
  } catch (error) {
    await kill(child);
    throw error;
  }

  return {
    origin,
    persistTo,
    async stop(stopOptions = {}) {
      stopped = true;
      if (stopOptions.graceful) {
        try {
          signalGroup(child, 'SIGTERM');
        } catch {
          // Already gone.
        }
        await Promise.race([once(child, 'exit'), sleep(10_000)]);
      }
      await kill(child);
    }
  };
}

/**
 * Fail early if there is no client bundle to serve.
 *
 * `npm test` builds it in *test* mode (`pretest`) — the mode carrying the `window.__vidi6`
 * hooks these specs read. A server here deliberately does not build it again: rebuilding
 * while the rest of the suite is loading pages from `dist/client` would take the hooks out
 * from under whatever else is running.
 */
export async function assertClientBuildIsThere(): Promise<void> {
  const index = `${repoRoot()}/dist/client/index.html`;
  try {
    await access(index);
  } catch {
    throw new Error(`${index} does not exist — run \`npm run build:test\` (Playwright's web server does it for you)`);
  }
}

/** Poll until the dev server answers anything at all (200 or 404: it is up). */
async function waitForReady(origin: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000) });
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`dev server at ${origin} never became ready`);
    await sleep(250);
  }
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid) process.kill(-child.pid, signal);
}

async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    signalGroup(child, 'SIGKILL');
  } catch {
    // Already gone.
  }
  await Promise.race([once(child, 'exit'), sleep(5_000)]);
}

function once(child: ChildProcess, event: 'exit'): Promise<void> {
  return new Promise((resolve) => child.once(event, () => resolve()));
}

function tail(lines: string[]): string {
  return lines.slice(-8).join('\n');
}

/** The repository root, which is where `wrangler.jsonc` and `dist/` are. */
function repoRoot(): string {
  // This file lives at tests/e2e/helpers/, so the root is three levels up. `import.meta.url`
  // is the only reliable anchor: Playwright runs specs from the root, but a helper must not
  // assume that.
  const here = new URL(import.meta.url).pathname;
  return here.slice(0, here.lastIndexOf('/tests/'));
}
