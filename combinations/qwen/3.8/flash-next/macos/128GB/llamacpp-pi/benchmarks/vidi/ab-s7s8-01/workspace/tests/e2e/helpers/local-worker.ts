// A throwaway `wrangler dev` for specs that must control the Worker's env.
//
// The shared webServer in playwright.config.ts may be a REUSED server (local
// runs reuse whatever answers the port), and the integration suite leaves a
// server started with `--var TEST_HOOKS:1` behind. For most specs that is
// harmless; for "the storage hooks must not exist in production" it is fatal:
// reusing that server makes the check vacuous.
//
// So this helper starts its own workerd on a port nobody is using, optionally
// with the flag, waits until the WORKER actually answers (not just the port),
// and shuts it down afterwards. Nothing is mocked: same runtime, same assets
// layer, same Durable Object storage as the shipped app.

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';

export interface LocalWorker {
  origin: string;
  stop(): Promise<void>;
}

function pidsOnPort(port: number): number[] {
  try {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim();
    return out ? out.split('\n').map(Number).filter((pid) => Number.isFinite(pid)) : [];
  } catch {
    return [];
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** A port with no listener at all (8900+ so it never collides with the
 * suites' fixed ports). */
function pickFreePort(start = 8900, tries = 40): number {
  for (let port = start; port < start + tries; port += 1) {
    if (pidsOnPort(port).length === 0) return port;
  }
  throw new Error(`no free port at or above ${start}`);
}

/** True once the Worker answers. A malformed board id is answered by the
 * Worker itself (404 since story 5, before any asset or room lookup), so a
 * reply here proves the Worker — not just the port — is up. */
async function workerReady(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/api/rooms/not-valid`, { signal: AbortSignal.timeout(1500) });
    return response.status === 404;
  } catch {
    return false;
  }
}

export async function startLocalWorker(opts: { testHooks: boolean }): Promise<LocalWorker> {
  const port = pickFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const storage = `/tmp/vidi-e2e-${port}`;
  rmSync(storage, { recursive: true, force: true });

  const args = ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', storage];
  if (opts.testHooks) args.push('--var', 'TEST_HOOKS:1');
  const child: ChildProcess = spawn('node', args, { stdio: 'ignore' });

  const deadline = Date.now() + 90_000;
  while (!(await workerReady(origin))) {
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`wrangler dev never became ready on port ${port}`);
    }
    await sleep(250);
  }

  return {
    origin,
    async stop(): Promise<void> {
      child.kill('SIGKILL');
      // The runtime process that holds the port is a child of wrangler; wait
      // for the port to be released so the next run starts clean.
      const until = Date.now() + 10_000;
      while (pidsOnPort(port).length > 0 && Date.now() < until) {
        for (const pid of pidsOnPort(port)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already gone */
          }
        }
        await sleep(200);
      }
    },
  };
}
