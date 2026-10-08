import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import path from 'path';

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  worker: {
    workers: [
      {
        name: 'integration-workers',
        main: 'src/worker/index.ts',
        compatibilityDate: '2024-11-11',
        durableObjects: {
          BINDINGS: [
            { name: 'BOARD_ROOM', className: 'BoardRoom' },
          ],
        },
        migrations: [
          { tag: 'v1', new_sqlite_classes: ['BoardRoom'] },
        ],
        vars: {
          TEST_HOOKS: '1',
        },
      },
    ],
  },
  test: {
    name: 'workers-integration',
    include: ['tests/integration/board-store.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: 'wrangler.jsonc' },
      },
    },
    hookTimeout: 60_000,
    testTimeout: 90_000,
  },
});
