import type { Env } from '../../src/worker/index.js';

// Give the `integration` project a typed `env` from `cloudflare:test`, so tests can
// reach the `BOARD_ROOM` Durable Object namespace to obtain per-board storage.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
