import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');

const PORT = 29042;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * The design specifies `@cloudflare/vitest-pool-workers` with a `SELF.fetch`
 * pattern, but the pool runtime cannot deliver WebSocket upgrade frames to test
 * clients (verified: the pool's ws client stays in CONNECTING; see NOTES.md).
 * We therefore run the same production Worker + Durable Objects on a local
 * `wrangler dev` server and drive it with the same wire protocol over the
 * network. The Worker under test is byte-for-byte the production code.
 */
export default async function () {
  process.env.INTEGRATION_BASE = BASE;
  const server: ChildProcess = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      // override the config file's inspector port (29041), which the e2e
      // wrangler dev may be using at the same time
      '--inspector-port',
      '29043',
      '--ip',
      '127.0.0.1',
      '--log-level',
      'error',
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let crash: string | null = null;
  server.stderr?.on('data', (d) => {
    const s = String(d);
    if (/fatal|error/i.test(s)) crash ??= s;
  });
  server.on('exit', (code) => {
    if (code !== null && code !== 0) crash ??= `wrangler exited with code ${code}`;
  });

  const waitForServer = (async () => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const res = await fetch(BASE + '/');
        if (res.ok) return;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`wrangler dev did not start: ${crash}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  await Promise.race([
    waitForServer,
    new Promise<never>((_, rej) =>
      server.on('exit', () => rej(new Error(`wrangler exited early: ${crash}`))),
    ),
  ]);
  await waitForServer.catch(() => undefined);

  return async () => {
    // Kill the whole process group (wrangler + workerd children).
    if (server.pid) {
      for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
        try {
          process.kill(-server.pid, sig);
          break;
        } catch {
          /* process group already gone */
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  };
}
