import { spawn, type ChildProcess } from 'child_process';
import { setTimeout as delay } from 'timers/promises';

const PORT = 8899;
const URL = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

/**
 * Story 5: create a board via the public API. Boards must be created
 * before anything can connect to them (a WebSocket connection no longer
 * implicitly creates a board).
 */
export async function createBoard(): Promise<string> {
  const res = await fetch(`${URL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) {
    throw new Error(`POST /api/boards → ${res.status}: ${await res.text()}`);
  }
  return (await res.json() as { id: string }).id;
}

export async function startServer(): Promise<string> {
  if (server) return URL;

  // Fail loudly if something else already holds the port (e.g. a stale
  // `wrangler dev` from a crashed run) — silently adopting it would make
  // tests run against the wrong worker build.
  try {
    const probe = await fetch(`${URL}/health`, { signal: AbortSignal.timeout(500) });
    if (probe.status !== 0) {
      throw new Error(
        `Port ${PORT} is already in use by another process. Kill stale wrangler/workerd processes and retry.`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Port ')) throw err;
    // fetch failed (connection refused / timeout) → port is free, continue.
  }

  // TEST_HOOKS is passed as a --var binding: wrangler does not forward
  // process env vars into the worker automatically. Note: this wrangler
  // version parses --var pairs on ':' (not '='), so 'TEST_HOOKS:1'.
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--var', 'TEST_HOOKS:1'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', TEST_HOOKS: '1' },
    cwd: process.cwd(),
    detached: true, // own process group so we can kill workerd children too
  });

  // Log server output for debugging
  server.stdout?.on('data', (data: Buffer) => {
    process.env.DEBUG_SERVER && process.stderr.write('[server] ' + data.toString());
  });
  server.stderr?.on('data', (data: Buffer) => {
    process.env.DEBUG_SERVER && process.stderr.write('[server:err] ' + data.toString());
  });

  // Wait for the server to be ready
  const startTime = Date.now();
  while (Date.now() - startTime < 55000) {
    try {
      const resp = await fetch(`${URL}/`, { method: 'GET' });
      if (resp.status !== 0) {
        return URL;
      }
    } catch {
      // Not ready yet
    }
    await delay(500);
  }
  throw new Error('Server did not start within 30s');
}

export async function stopServer(): Promise<void> {
  if (server && server.pid) {
    // Kill the whole process group (wrangler + workerd children).
    const pid = server.pid;
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    await delay(1000);
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
    server = null;
  }
}

export { PORT, URL };
