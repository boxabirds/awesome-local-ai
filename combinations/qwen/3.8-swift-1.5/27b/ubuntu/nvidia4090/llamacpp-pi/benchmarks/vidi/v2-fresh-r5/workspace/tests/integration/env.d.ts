import type { Env } from '../../src/worker/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
