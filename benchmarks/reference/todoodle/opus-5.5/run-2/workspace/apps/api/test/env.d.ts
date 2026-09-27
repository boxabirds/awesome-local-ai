import type { D1Migration } from 'cloudflare:test';
import type { Env as WorkerEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      /** Set only by the production-gate project, which simulates production inside Miniflare. */
      TEST_SIMULATED_ENVIRONMENT?: string;
    }
  }
}
