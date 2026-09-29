import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import type { PoolOptions } from 'vitest/node';
import react from '@vitejs/plugin-react';

export default defineWorkersConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // The workers pool is the default under defineWorkersConfig; opt
          // these two projects back into the node pool.
          pool: 'forks',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          server: { deps: { inline: ['yjs', 'lib0'] } },
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          pool: 'forks',
          environment: 'jsdom',
          setupFiles: ['tests/component/setup.ts'],
          include: ['tests/component/**/*.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          // The cloudflare pool's options are typed by
          // @cloudflare/vitest-pool-workers, not by vitest's built-in PoolOptions.
          poolOptions: {
            workers: {
              main: 'src/worker/index.ts',
              // Single runtime with a short worker name: the per-file isolated
              // storage layout breaks on this workerd (sqlite sidecar files),
              // and per-file worker names exceed the 255-char path limit in
              // this deep checkout. Rooms stay isolated by board id anyway;
              // each test uses a fresh board id.
              singleWorker: true,
              isolatedStorage: false,
              wrangler: { configPath: 'wrangler.jsonc' },
            },
          } as unknown as PoolOptions,
        },
      },
    ],
  },
});
