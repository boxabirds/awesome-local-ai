// wrangler-process (story 4, task 6 helper): a real `wrangler dev` process
// with durable SQLite persistence (`--persist-to`), started and killed per
// test so persistence can be proven across genuine process restarts.
//
// The persistence specs (persistence.spec.ts, broken-board.spec.ts) run in
// their own Playwright config without the shared Vite webServer; they talk
// to the wrangler port only.

import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WRANGLER_PORT = 28433;
export const WRANGLER_BASE = `http://127.0.0.1:${WRANGLER_PORT}`;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const READY_TIMEOUT_MS = 120_000;
const KILL_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- client build (test mode so window.__vidi6 exists) ---------------------

let buildPromise: Promise<void> | null = null;

/** Recursively collect file mtimes under `dir` (newest wins). */
async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(full));
    } else {
      newest = Math.max(newest, (await stat(full)).mtimeMs);
    }
  }
  return newest;
}

/**
 * Build `dist/client` in test mode when missing or stale relative to the
 * client/worker sources. Cached per process: the build runs at most once.
 */
export function ensureClientTestBuild(): Promise<void> {
  if (buildPromise === null) {
    buildPromise = (async () => {
      const distIndex = join(REPO_ROOT, 'dist', 'client', 'index.html');
      const modeMarker = join(REPO_ROOT, 'dist', 'client', '.build-mode');
      let distMtime = 0;
      let markerMtime = 0;
      let mode = '';
      try {
        distMtime = (await stat(distIndex)).mtimeMs;
      } catch {
        // missing → rebuild
      }
      try {
        mode = (await readFile(modeMarker, 'utf8')).trim();
        markerMtime = (await stat(modeMarker)).mtimeMs;
      } catch {
        // no marker → not a test-mode build
      }
      const sourceMtime = await newestMtime(join(REPO_ROOT, 'src'));
      // A test-mode build is fresh only when: the marker says 'test', the
      // marker is at least as new as index.html (a later production build
      // would have overwritten it), and the build is at least as new as the
      // sources.
      if (mode === 'test' && markerMtime >= distMtime && distMtime >= sourceMtime) return;
      await new Promise<void>((resolveP, rejectP) => {
        execFile(
          'npx',
          ['--no-install', 'vite', 'build', '--mode', 'test'],
          { cwd: REPO_ROOT, timeout: 120_000 },
          (error) => (error ? rejectP(error) : resolveP()),
        );
      });
      await writeFile(modeMarker, 'test');
    })().catch((error) => {
      buildPromise = null; // allow a retry on the next call
      throw error;
    });
  }
  return buildPromise;
}

// --- process lifecycle -------------------------------------------------------

async function isPortFree(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    res.body?.cancel();
    return false; // something answered
  } catch {
    return true; // connection refused → free
  }
}

async function waitForReady(base: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok) {
        res.body?.cancel();
        return;
      }
    } catch {
      // not up yet
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`wrangler not ready at ${base} within ${timeoutMs}ms`);
    }
    await sleep(250);
  }
}

export interface WranglerProcess {
  /** The `--persist-to` directory; survives `stop()`/`start()` pairs. */
  readonly persistDir: string;
  readonly base: string;
  /** Spawn `wrangler dev` and wait until it serves HTTP. */
  start(): Promise<void>;
  /** Kill the process tree (SIGKILL: no graceful flush). No-op if stopped. */
  stop(): Promise<void>;
  /** stop() and remove the persist dir. */
  dispose(): Promise<void>;
  /** Tail of the process log (for failure diagnostics). */
  logTail(n?: number): string;
}

/**
 * A wrangler dev process bound to WRANGLER_PORT persisting DO SQLite under a
 * fresh temp dir. `start()`/`stop()` may be repeated against the same
 * persist dir to simulate overnight restarts.
 */
export async function createWranglerProcess(): Promise<WranglerProcess> {
  const persistDir = await mkdtemp(join(tmpdir(), 'vidi6-e2e-'));
  let proc: ChildProcess | null = null;
  let logTailLines: string[] = [];

  function logTail(n = 40): string {
    return logTailLines.slice(-n).join('\n');
  }

  async function start(): Promise<void> {
    if (proc !== null) throw new Error('wrangler already running');
    if (!(await isPortFree(WRANGLER_PORT))) {
      throw new Error(`port ${WRANGLER_PORT} is busy; a previous wrangler may still be running`);
    }
    await ensureClientTestBuild();

    proc = spawn(
      'npx',
      [
        '--no-install',
        'wrangler',
        'dev',
        '--port',
        String(WRANGLER_PORT),
        '--persist-to',
        persistDir,
        '--config',
        'wrangler.e2e.jsonc',
      ],
      {
        cwd: REPO_ROOT,
        // Own process group so stop() can kill wrangler and its workerd
        // child together.
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_UPDATE_CHECK: '1' },
      },
    );
    const remember = (chunk: Uint8Array) => {
      for (const line of chunk.toString().split('\n')) logTailLines.push(line);
      if (logTailLines.length > 400) logTailLines = logTailLines.slice(-400);
    };
    proc.stdout?.on('data', remember);
    proc.stderr?.on('data', remember);

    try {
      await waitForReady(WRANGLER_BASE, READY_TIMEOUT_MS);
    } catch (error) {
      await stop();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- wrangler log ---\n${logTail()}`);
    }
  }

  function stop(): Promise<void> {
    const p = proc;
    proc = null;
    if (p === null) return Promise.resolve();
    return new Promise<void>((resolveP) => {
      const timer = setTimeout(() => resolveP(), KILL_TIMEOUT_MS);
      p.once('exit', () => {
        clearTimeout(timer);
        resolveP();
      });
      try {
        // Negative pid: the whole process group (wrangler + workerd).
        process.kill(-p.pid!, 'SIGKILL');
      } catch {
        clearTimeout(timer);
        resolveP();
      }
    });
  }

  async function dispose(): Promise<void> {
    await stop();
    await rm(persistDir, { recursive: true, force: true });
  }

  return { persistDir, base: WRANGLER_BASE, start, stop, dispose, logTail };
}

// --- test hooks (worker routes, enabled via wrangler.e2e.jsonc) -------------

export async function testHook(
  boardId: string,
  op: string,
  body?: Uint8Array,
): Promise<{ status: number; json(): Promise<unknown> }> {
  const res = await fetch(`${WRANGLER_BASE}/__test/boards/${boardId}/${op}`, {
    method: 'POST',
    body: body === undefined ? undefined : body,
  });
  return { status: res.status, json: () => res.json() };
}
