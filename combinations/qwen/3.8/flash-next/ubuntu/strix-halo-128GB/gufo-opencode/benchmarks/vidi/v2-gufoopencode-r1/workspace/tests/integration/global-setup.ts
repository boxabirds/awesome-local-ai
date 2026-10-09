import { unstable_dev } from 'wrangler';
import type { Vitest } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    workerPort: number;
  }
}

// Boots the Worker once for the whole integration project with the real
// wrangler.jsonc (Durable Object + assets), mirroring how the app is deployed
// and how the e2e suite serves it.
export default async function setup({ provide }: Vitest): Promise<() => Promise<void>> {
  const worker = await unstable_dev('src/worker/index.ts', {
    config: 'wrangler.jsonc',
    ip: '127.0.0.1',
    port: 0,
    persist: false,
    logLevel: 'error',
    inspect: false
  });
  provide('workerPort', worker.port);
  return async () => {
    await worker.stop();
  };
}
