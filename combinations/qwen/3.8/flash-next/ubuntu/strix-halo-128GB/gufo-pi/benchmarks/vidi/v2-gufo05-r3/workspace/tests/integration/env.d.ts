// Teach `cloudflare:test`'s `env` about this Worker's bindings.
import type { Env } from '../../src/worker/index';

declare module 'cloudflare:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}
