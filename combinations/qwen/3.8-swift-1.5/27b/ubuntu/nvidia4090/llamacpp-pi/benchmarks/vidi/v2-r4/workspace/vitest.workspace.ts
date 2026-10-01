import { defineWorkspace } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// SPA fallback for the ASSETS binding in the workers pool: the real worker routes every
// non-room request to `env.ASSETS`. In tests we return a 200 HTML page so the SPA-fallback
// routing test (worker.test.ts TC-06) behaves like production.
const assetsFallback = (_req: Request): Response =>
  new Response('<html><body>OK</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
    },
  },
  {
    test: {
      name: 'component',
      environment: 'jsdom',
      include: ['tests/component/**/*.test.{ts,tsx}'],
    },
  },
  defineWorkersProject({
    test: {
      name: 'integration',
      pool: '@cloudflare/vitest-pool-workers',
      poolOptions: {
        workers: {
          main: 'src/worker/index.ts',
          isolatedStorage: true,
          miniflare: {
            compatibilityDate: '2024-09-01',
            durableObjects: {
              BOARD_ROOM: {
                className: 'BoardRoom',
                useSQLite: true,
              },
            },
            serviceBindings: {
              ASSETS: assetsFallback,
            },
            // NOTE: no r2Buckets binding in tests. The miniflare R2 bucket is
            // sqlite-backed and its persistent sidecar files are incompatible
            // with this test pool's storage handling, so the worker falls back
            // to its in-memory asset store (see src/worker/asset-store.ts).
            // Production binds the real R2 bucket via wrangler.jsonc.
            bindings: {
              TEST_HOOKS: '1',
            },
          },
        },
      },
      include: ['tests/integration/**/*.test.{ts,tsx}'],
      testTimeout: 60000,
      hookTimeout: 120000,
      fileParallelism: false,
    },
  }),
]);
