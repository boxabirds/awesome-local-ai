import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      // Real Worker + Durable Object in workerd (design: mock vs real
      // boundaries — the room is the unit under test; no mocks).
      // defineWorkersProject injects the plugin that resolves `cloudflare:test`
      // and sets the workerd resolve conditions — plain defineConfig does not.
      defineWorkersProject({
        // No `extends: true`: the workerd project must not inherit the
        // root's react plugin / jsdom assumptions (and the pool's type for
        // project configs omits `extends` in vitest 3.2).
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // workerd cold starts (DO instantiation, module compilation) are
          // slow; the tests themselves poll with short internal timeouts.
          testTimeout: 30_000,
          pool: '@cloudflare/vitest-pool-workers',
          // The workers pool's options are not in vitest's core types.
          poolOptions: {
            workers: {
              wrangler: {
                configPath: 'wrangler.jsonc',
              },
              // Per-test-file storage push/pop walks the DO persist dir and
              // chokes on workerd's WAL sidecar files (*.sqlite-shm). Story 3
              // rooms are in-memory anyway (story 4 adds real persistence),
              // and every test uses a fresh random board id, so shared
              // storage is harmless.
              isolatedStorage: false,
            },
          } as Record<string, unknown>,
        },
      }),
    ],
  },
});
