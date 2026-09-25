// Bindings seen by `cloudflare:test` / `cloudflare:workers` `env` in the integration tests.
import type { Env as WorkerEnv } from './index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
