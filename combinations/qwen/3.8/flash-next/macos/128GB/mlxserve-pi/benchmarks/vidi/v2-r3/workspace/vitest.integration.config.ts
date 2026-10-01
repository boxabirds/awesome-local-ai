// The integration project of `vitest.config.ts`, kept in its own file because
// it runs on a different pool: `defineWorkersProject` switches Vitest to
// `pool: 'workers'` (the Workers runtime, workerd, through miniflare) and adds
// the pool plugin, and Vitest only resolves that for a standalone config file.
//
// What the project gets from `wrangler.jsonc`: the real Worker entry, the real
// ASSETS binding for the built client and the real BoardRoom Durable Object,
// so every test drives the deployed shape of story 3 rather than a stub.
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Vitest looks a custom pool up with CommonJS resolution, and this pool only
// publishes an ESM entry point, so the lookup misses and Vitest then treats the
// name as a path. Naming the pool module directly is the documented escape
// hatch for ESM-only pools.
// named this way (`pool` is typed as that literal, hence the assertion).
const localRequire = createRequire(import.meta.url);
const workersPool = join(
  dirname(localRequire.resolve('@cloudflare/vitest-pool-workers/config')),
  '..',
  'pool',
  'index.mjs',
) as '@cloudflare/vitest-pool-workers';

export default defineWorkersProject({
  test: {
    name: 'integration',
    pool: workersPool,
    include: ['tests/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // The BoardRoom tests keep sockets open on purpose, which is exactly
        // what the per-test isolated-storage snapshot cannot unwind ("Failed
        // to pop isolated storage stack frame"). One storage for the whole run
        // is also what production looks like: every test uses its own board id,
        // so boards stay apart the way they do when deployed.
        isolatedStorage: false,
      },
    },
  },
});
