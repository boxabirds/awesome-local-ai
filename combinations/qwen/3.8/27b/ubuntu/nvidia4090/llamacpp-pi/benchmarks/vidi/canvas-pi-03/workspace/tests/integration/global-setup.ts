import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import path from 'node:path';

/**
 * Global setup for the integration project: boots ONE real `wrangler dev`
 * server (real worker + real Durable Object + real WebSockets) on a fixed
 * port and keeps it alive for the whole (serial) integration run.
 *
 * The setup function returns a teardown that kills the server.
 *
 * `dist/client` must already be built (the `test:integration` script runs
 * `build:e2e` first) so the SPA-asset fallback works.
 */
const PORT = 8801;
const WRANGLER = path.resolve(__dirname, '../../node_modules/wrangler/bin/wrangler.js');

let child: ChildProcess | null = null;
let stderr = '';

function waitForReady(timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = request({ host: '127.0.0.1', port: PORT, path: '/', method: 'GET' }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
      req.end();
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`wrangler dev not ready on :${PORT} within ${timeoutMs}ms\n${stderr.slice(-4000)}`));
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

export default async function setup(): Promise<() => Promise<void>> {
  // TEST_HOOKS:1 exposes the /__test/boards/:id/:op routes the persistence
  // tests use to reach into the Durable Object's SQLite. Colon-separated
  // (wrangler splits --var on ':').
  child = spawn(
    process.execPath,
    [WRANGLER, 'dev', '--port', String(PORT), '--local', '--var', 'TEST_HOOKS:1'],
    {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    detached: true,
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  child.stdout?.resume();
  await waitForReady(120_000);

  return async function teardown(): Promise<void> {
    if (!child?.pid) return;
    const pid = child.pid;
    const killGroup = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
      } catch {
        try {
          child?.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    killGroup('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    killGroup('SIGKILL');
    child = null;
  };
}
