/**
 * E2E helper: start/stop a dedicated `wrangler dev` bound to a persistent
 * storage directory so board data survives a real process restart (story 4).
 * Each test spins up its own instance (its own Playwright project has no shared
 * webServer). TEST_HOOKS is enabled so tests can seed/corrupt/inspect storage.
 */
import { type ChildProcess, spawn, execSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface WranglerHandle {
  port: number;
  url: string;
  persistDir: string;
  stop(): Promise<void>;
}

const REPO = resolve(import.meta.dirname, '../../..');

async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 426) return;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`wrangler dev did not become ready at ${url}: ${lastErr}`);
}

/**
 * Start `wrangler dev` on `port` persisting DO/KV state under a fresh temp dir.
 * Resolve once the server answers HTTP.
 */
export async function startWrangler(port: number, existingPersistDir?: string): Promise<WranglerHandle> {
  const persistDir = existingPersistDir ?? mkdtempSync(join(tmpdir(), 'vidi6-persist-'));

  // Clear any stale listener (an orphaned workerd from a previous run would
  // otherwise keep the port bound and answer with old in-memory state).
  try {
    execSync(`fuser -k ${port}/tcp 2>/dev/null || true`);
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 300));

  // `detached: true` makes the child a process-group leader so stop() can kill
  // the whole tree: `npx wrangler dev` itself spawns a workerd child that would
  // otherwise survive and keep the port bound.
  const proc: ChildProcess = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--persist-to',
      persistDir,
      '--var',
      'TEST_HOOKS:1',
    ],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );

  proc.on('error', (err) => {
    console.error('wrangler spawn error', err);
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForHttp(`${url}/`);

  return {
    port,
    url,
    persistDir,
    async stop() {
      killTree(proc);
      // Make sure the port is released before the next start on the same port.
      try {
        execSync(`fuser -k ${port}/tcp 2>/dev/null || true`);
      } catch {
        /* ignore */
      }
      await new Promise<void>((res) => {
        proc.on('exit', () => res());
        setTimeout(res, 4000);
      });
    },
  };
}

function killTree(proc: ChildProcess): void {
  if (proc.pid == null) return;
  try {
    // Negative pid → the whole process group (wrangler + its workerd child).
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

export function cleanupPersistDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Call a TEST_HOOKS route on a running wrangler instance. */
export async function testHook(
  handle: WranglerHandle,
  boardId: string,
  op: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<any> {
  const res = await fetch(`${handle.url}/__test/boards/${boardId}/${op}`, { method });
  if (!res.ok) throw new Error(`test hook ${op} failed: ${res.status}`);
  return res.json();
}
