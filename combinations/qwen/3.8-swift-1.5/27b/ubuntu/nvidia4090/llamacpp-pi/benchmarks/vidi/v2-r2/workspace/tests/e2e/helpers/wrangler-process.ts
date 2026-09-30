import { spawn, type ChildProcess } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Controls a dedicated `wrangler dev --persist-to <dir>` process for the
 * persistence e2e specs. These specs manage the worker process lifecycle
 * themselves (kill + restart mid-test), so they do NOT use the shared
 * Playwright webServer — they run against their own port (8990) with
 * persistent SQLite storage in a temp dir.
 *
 * TEST_HOOKS is enabled so specs can seed/corrupt board storage directly.
 */

const PORT = 8990;
export const PERSIST_URL = `http://127.0.0.1:${PORT}`;

let proc: ChildProcess | null = null;

export async function startWranglerProcess(persistDir: string): Promise<string> {
  if (proc) throw new Error('wrangler process already running');

  proc = spawn(
    'npx',
    [
      'wrangler', 'dev',
      '--port', String(PORT),
      '--ip', '127.0.0.1',
      '--persist-to', persistDir,
      '--var', 'TEST_HOOKS:1',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
      cwd: process.cwd(),
      detached: true, // own process group so workerd children can be killed too
    },
  );

  const start = Date.now();
  while (Date.now() - start < 55_000) {
    try {
      const resp = await fetch(`${PERSIST_URL}/health`);
      if (resp.ok) return PERSIST_URL;
    } catch {
      // not ready yet
    }
    await delay(400);
  }
  throw new Error('wrangler process did not become ready within 55s');
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function stopWranglerProcess(): Promise<void> {
  if (proc?.pid) {
    const pid = proc.pid;
    // SIGTERM first: workerd shuts down gracefully and flushes its
    // `--persist-to` storage to disk. A hard kill before the flush loses
    // recent writes, so give it up to 20s to exit on its own.
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    const start = Date.now();
    while (groupAlive(pid) && Date.now() - start < 20_000) {
      await delay(250);
    }
    if (groupAlive(pid)) {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      await delay(500);
    }
  }
  proc = null;
}

/** Creates a fresh temp dir for `--persist-to`. */
export function makePersistDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vidi6-e2e-persist-'));
}
