/**
 * The bindings the Worker is deployed with, told to the types of the whole
 * program. `@cloudflare/workers-types` leaves `Cloudflare.Env` open on purpose so
 * a project can declare its own — this is what `wrangler types` writes — and that
 * is what makes `env.BOARD_ROOM` and `env.ASSETS` mean something in
 * `tests/integration`.
 */
import type { Env as WorkerEnv } from '../../src/worker/index';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
