// The bindings the Worker is configured with (`wrangler.jsonc`) are what
// `cloudflare:test`'s `env` holds in the integration tests.
import type { Env } from '../../src/worker/index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
