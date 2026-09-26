import { spawn, type ChildProcess } from 'node:child_process';

// Boots ONE `wrangler dev` instance for the whole integration project
// (vitest globalSetup). This is the same workerd runtime the app ships on:
// Worker entry + Durable Object + assets, no mocks. If a server is already
// answering on the port (e.g. a leftover `wrangler dev`), we reuse it.

const PORT = Number(process.env.WORKER_PORT ?? '8790');
const BASE = `http://127.0.0.1:${PORT}`;

async function healthy(): Promise<boolean> {
  try {
    // A bad board id deterministically answers 400 once the worker is up,
    // regardless of whether client assets are built.
    const response = await fetch(`${BASE}/api/rooms/not-a-valid-id`, { signal: AbortSignal.timeout(1500) });
    return response.status === 400;
  } catch {
    return false;
  }
}

const WORKERD = new URL('../../node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd', import.meta.url).pathname;

export default async function startWorkerServer(): Promise<() => Promise<void>> {
  if (await healthy()) return () => Promise.resolve(); // reuse an existing dev server

  const child: ChildProcess = spawn(
    process.execPath,
    ['node_modules/wrangler/bin/wrangler.js', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', `/tmp/vidi-it-main`],
    { cwd: process.cwd(), env: { ...process.env, CI: '1', MINIFLARE_WORKERD_PATH: WORKERD }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let tail = '';
  const capture = (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const deadline = Date.now() + 60_000;
  while (!(await healthy())) {
    if (child.exitCode !== null) {
      throw new Error(`wrangler dev exited before becoming ready:\n${tail}`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `wrangler dev did not become ready within 60s (is "npm run build:test" built?):\n${tail}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return async () => {
    child.kill('SIGTERM');
  };
}
