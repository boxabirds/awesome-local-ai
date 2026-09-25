import type { Env as WorkerEnv } from '../../src/worker/index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
