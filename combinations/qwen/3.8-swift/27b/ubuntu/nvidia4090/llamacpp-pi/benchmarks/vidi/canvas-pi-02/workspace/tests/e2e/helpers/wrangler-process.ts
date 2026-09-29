// Per-test wrangler dev process manager for the persistence e2e specs
// (TC-19 to TC-21). Each test gets its own `wrangler dev --persist-to`
// instance on its own port with its own SQLite dir, so "kill and restart"
// is a real process restart against a durable store — the shared
// webServer-based e2e project cannot do that.

import { execSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Workspace root (tests/e2e/helpers -> 3 levels up). */
const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface WranglerProcess {
  readonly port: number;
  readonly url: string;
  readonly persistDir: string;
  stop(): Promise<void>;
}

export interface StartOptions {
  /** Reuse an existing persist dir (a restart over the same SQLite store).
   *  A fresh dir is created when omitted. */
  persistDir?: string;
  timeoutMs?: number;
  /** Skip wiping the shared .wrangler/tmp build cache. Default true (a
   *  stale cache can serve an older worker bundle). Set false when ANOTHER
   *  dev server is running: wiping the cache directory hangs it. */
  wipeBuildCache?: boolean;
}

/** Starts `wrangler dev --persist-to <dir>` and resolves once the server
 *  answers HTTP on the given port. */
export async function startWrangler(
  port: number,
  options: StartOptions = {},
): Promise<WranglerProcess> {
  const persistDir = options.persistDir ?? (await mkdtemp(path.join(os.tmpdir(), `vidi6-e2e-${port}-`)));
  await mkdir(persistDir, { recursive: true });
  // wrangler dev env file: enables the /_test/ seam for this process only.
  const envFile = path.join(persistDir, 'e2e.env');
  await writeFile(envFile, 'TEST_HOOKS=1\n');
  // Force a fresh worker build: wrangler's dev build cache (.wrangler/tmp)
  // can go stale and serve an older bundle of the worker source. (Skipped
  // when another dev server is live — removing the dir hangs it.)
  if (options.wipeBuildCache !== false) {
    await rm(path.join(WORKSPACE_ROOT, '.wrangler', 'tmp'), { recursive: true, force: true });
  }
  const url = `http://127.0.0.1:${port}`;
  const attemptTimeout = options.timeoutMs ?? 120_000;
  const attempts = 4;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A fresh process group so stop() can SIGKILL the whole tree
    // (npx → wrangler → workerd); otherwise workerd outlives npx and
    // keeps the port bound ("Address already in use" on restart).
    const child = spawn(
      'npx',
      [
        'wrangler',
        'dev',
        '--persist-to', persistDir,
        '--port', String(port),
        '--ip', '127.0.0.1',
        // Enables the /_test/ seam (state polling, snapshot corruption) —
        // gated on env.TEST_HOOKS, which production config never sets.
        // (wrangler 4's --var mangles KEY=VALUE; --env-file keeps it a string)
        '--env-file', envFile,
        // Non-TTY stdout suppresses worker console output by default.
        '--log-level', 'debug',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    const logs: string[] = [];
    const logFile = await import('node:fs').then((m) => m.createWriteStream(`/tmp/wrangler-debug-${port}.log`, { flags: 'a' }));
    child.stdout?.on('data', (d: Buffer) => { logs.push(d.toString()); logFile.write(d); });
    child.stderr?.on('data', (d: Buffer) => { logs.push(d.toString()); logFile.write(d); });
    const stop = async (): Promise<void> => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      // workerd runs in its own session (set by wrangler), so the group
      // kill above does not reach it. Kill whatever still holds the port.
      await killPortListener(port);
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once('exit', () => resolve());
      });
    };
    const deadline = Date.now() + attemptTimeout;
    for (;;) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.status < 500) {
          return { port, url, persistDir, stop };
        }
      } catch {
        // Not up yet.
      }
      if (child.exitCode !== null) {
        await stop();
        lastError = new Error(
          `wrangler dev exited early (code ${child.exitCode}):\n${logs.join('')}`,
        );
        break; // retry: the previous instance may still be releasing the port
      }
      if (Date.now() > deadline) {
        await stop();
        throw new Error(
          `wrangler dev did not become ready within ${attemptTimeout}ms:\n${logs.join('')}`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    // Brief pause for the OS to release the port before retrying.
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastError ?? new Error('wrangler dev failed to start');
}

/** SIGKILLs whatever process is listening on `port` (no-op if none). */
async function killPortListener(port: number): Promise<void> {
  for (let i = 0; i < 10; i++) {
    let pids: string[] = [];
    try {
      const out = execSync('ss -ltnp 2>/dev/null | grep -E ":' + port + ' "', {
        encoding: 'utf8',
      });
      pids = [...out.matchAll(/pid=(\d+)/g)].map((m) => m[1]);
    } catch {
      return; // no listener (ss missing or nothing bound)
    }
    if (pids.length === 0) return;
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Deletes a persist dir (cleanup after a test). */
export async function removePersistDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
