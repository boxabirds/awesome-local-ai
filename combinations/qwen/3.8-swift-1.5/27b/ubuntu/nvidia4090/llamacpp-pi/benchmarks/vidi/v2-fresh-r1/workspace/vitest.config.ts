import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineConfig({
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
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      // Integration tests run the real Worker + BoardRoom Durable Object in
      // workerd (via wrangler.jsonc). Requires `dist/client` to exist (the
      // ASSETS fetcher serves it), so run `npm run build` first — the
      // `test:integration` script does this.
      defineWorkersProject({
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          poolOptions: {
            workers: {
              wrangler: { configPath: 'wrangler.jsonc' },
              // BoardRoom docs are memory-only (persistence lands in story 4)
              // and every test uses a fresh board id, so per-test storage
              // isolation is unnecessary. Leaving it on makes the pool fail to
              // pop the sqlite frame while DO sockets are still draining.
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
