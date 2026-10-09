import type { Env } from '../../src/worker/index';

// Makes the wrangler bindings (BOARD_ROOM, ASSETS) visible on `env` from
// 'cloudflare:test' in the integration tests.
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
