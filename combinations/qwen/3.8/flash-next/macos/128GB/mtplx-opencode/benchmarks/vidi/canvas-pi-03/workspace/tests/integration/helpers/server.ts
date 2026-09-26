// Address helpers for integration tests. Each test FILE boots its own
// `wrangler dev` on a dedicated port so files can run in parallel and one
// file can restart its server mid-suite without affecting others.

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_PORT = 8790;
export const HTTP_ORIGIN = `http://127.0.0.1:${DEFAULT_PORT}`;
export const WS_ORIGIN = `ws://127.0.0.1:${DEFAULT_PORT}`;

export interface DevServer {
  port: number;
  wsOrigin: string;
  proc: ChildProcess;
  stop(): Promise<void>;
}

const WORKERD = new URL('../../../node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd', import.meta.url).pathname;

async function healthy(port: number): Promise<boolean> {
  try {
    // A malformed board id answers 400 as soon as the worker answers at all.
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms/not-valid`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status === 400;
  } catch {
    return false;
  }
}

/** Spawn `wrangler dev` on `port` (or reuse a healthy one) and wait for it. */
export async function startServer(port: number): Promise<DevServer> {
  if (await healthy(port)) return wrap(port, null);
  const proc = spawn(
    process.execPath,
    [
      'node_modules/wrangler/bin/wrangler.js',
      'dev',
      '--config',
      'wrangler.jsonc',
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      // Unique DO/queue storage per instance so parallel dev servers never
      // fight over one persist dir (sharing it makes workerd exit early).
      '--persist-to',
      `/tmp/vidi-it-${port}`,
    ],
    {
      cwd: new URL('../../../', import.meta.url).pathname,
      env: { ...process.env, CI: '1', MINIFLARE_WORKERD_PATH: WORKERD },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let tail = '';
  const capture = (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-4000);
  };
  proc.stdout?.on('data', capture);
  proc.stderr?.on('data', capture);
  const deadline = Date.now() + 60_000;
  while (!(await healthy(port))) {
    if (proc.exitCode !== null) throw new Error(`wrangler dev exited early on port ${port}:
${tail}`);
    if (Date.now() > deadline) throw new Error(`wrangler dev not ready on port ${port}:
${tail}`);
    await sleep(250);
  }
  return wrap(port, proc);
}

function wrap(port: number, proc: ChildProcess | null): DevServer {
  return {
    port,
    wsOrigin: `ws://127.0.0.1:${port}`,
    proc: proc ?? (process as unknown as ChildProcess),
    async stop() {
      proc?.kill('SIGKILL');
      await sleep(400);
    },
  };
}

/** Kill and re-spawn the same port: fresh isolate, DO state lost. */
export async function restartServer(server: DevServer): Promise<DevServer> {
  await server.stop();
  return startServer(server.port);
}
