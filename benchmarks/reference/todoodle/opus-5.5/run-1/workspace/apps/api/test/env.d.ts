import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env.ts';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      /** ENVIRONMENT from the base wrangler.toml [vars]; always 'local'. */
      TEST_BASE_ENVIRONMENT: string;
      /** Set only in projects that simulate staging/production inside Miniflare. */
      TEST_SIMULATED_ENVIRONMENT?: string;
    }
  }
}
