/**
 * What `env` looks like inside a workerd integration test.
 *
 * `cloudflare:test` hands back the Worker's own bindings, typed against a global
 * `Cloudflare.Env` that nobody in this project has described — so `env.BOARD_ROOM`
 * typechecked as nothing until now, which is how a test could name a binding that does
 * not exist. This merges the Worker's own `Env` into it, so the bindings a test reaches
 * for are the ones the Worker is configured with (see `wrangler.jsonc`).
 */
import type { Env as WorkerEnv } from '../../src/worker/board-room';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

export {};
