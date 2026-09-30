import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
      // Integration runs inside workerd, against the real Worker entry, the
      // real BoardRoom Durable Object and real WebSockets (design: Mock vs real
      // boundaries). Bindings and assets come from `wrangler.jsonc`, which also
      // means the assets under test are the ones `wrangler dev` would serve.
      defineWorkersProject({
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          poolOptions: {
            workers: {
              main: './src/worker/index.ts',
              // A board connection is an open resource that outlives the
              // individual test that opened it, which per-test isolated storage
              // cannot handle (it fails to pop the Durable Object's storage).
              // This story's BoardRoom keeps no storage at all — story 4 turns
              // this back on when the board is persisted.
              isolatedStorage: false,
              // The BoardRoom and assets bindings, the compatibility date and
              // the built assets all come from the same wrangler.jsonc that
              // `wrangler dev` and `wrangler deploy` use.
              wrangler: { configPath: './wrangler.jsonc' },
            },
          },
        },
      }),
    ],
  },
});
