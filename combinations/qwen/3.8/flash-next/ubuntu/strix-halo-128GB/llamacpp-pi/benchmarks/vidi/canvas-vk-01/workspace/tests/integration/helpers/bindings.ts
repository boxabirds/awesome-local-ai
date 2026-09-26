import { env } from 'cloudflare:test';

import type { Env } from '../../../src/worker/env';

/**
 * `cloudflare:test` types `env` as `Cloudflare.Env`, which this project does not
 * augment; the Worker's own `Env` describes the bindings in `wrangler.jsonc` and
 * is what these tests actually use.
 */
export const bindings = env as unknown as Env;
