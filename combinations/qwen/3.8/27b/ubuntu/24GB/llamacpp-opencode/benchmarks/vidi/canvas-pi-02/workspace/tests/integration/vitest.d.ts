import type { Env } from '../../src/worker/index';

/**
 * The test environment mirrors the Worker's `Env`, so tests can address the
 * BoardRoom namespace directly (e.g. via runInDurableObject).
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
