/**
 * Types the `cloudflare:test` env for the integration project: it carries
 * the worker's bindings (BOARD_ROOM, ASSETS) from wrangler.jsonc.
 *
 * Must be a module (the trailing `export {}`) so the `declare module` block
 * is a proper augmentation of the pool's ambient declaration.
 */

import type { Env } from '../../../src/worker/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

export {};
