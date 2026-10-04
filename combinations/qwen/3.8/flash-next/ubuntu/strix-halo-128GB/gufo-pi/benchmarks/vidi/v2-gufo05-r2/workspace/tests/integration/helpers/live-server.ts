/**
 * The live server the room tests run against: the real Worker, the real
 * `BoardRoom` Durable Object and the real static assets, started in-process with
 * `unstable_dev` (the same local runtime `wrangler dev` uses) from `wrangler.jsonc`.
 *
 * Why a real server: `SELF.fetch` from `@cloudflare/vitest-pool-workers` cannot
 * carry a WebSocket conversation — only the first frame in each direction gets
 * through the loopback RPC, which is precisely the thing this story has to test.
 * Everything above the socket (the Worker routing, the Durable Object, Yjs) is
 * still the production code, running in workerd.
 */

import { unstable_dev, type Unstable_DevOptions, type Unstable_DevWorker } from 'wrangler';

import { LIVE_HTTP_URL, LIVE_PORT } from './ws-client';

let worker: Unstable_DevWorker | undefined;

export async function startLiveServer(): Promise<void> {
  worker = await unstable_dev(
    // The entry comes from wrangler.jsonc (`main`); passing it twice makes
    // wrangler complain about two sources for the same Worker.
    undefined as unknown as string,
    {
      config: './wrangler.jsonc',
      ip: '127.0.0.1',
      port: LIVE_PORT,
      inspectorPort: LIVE_PORT + 1,
      persist: false,
      logLevel: 'error',
    } satisfies Unstable_DevOptions,
  );
  await waitForServer();
}

export async function stopLiveServer(): Promise<void> {
  const current = worker;
  worker = undefined;
  if (current) await current.stop();
}

/** Poll until the Worker answers, so no test races the boot. */
async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${LIVE_HTTP_URL}/`);
      if (response.status > 0) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`live server never came up on ${LIVE_HTTP_URL}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
