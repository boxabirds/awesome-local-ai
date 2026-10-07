import { defineConfig, defineProject } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      }),
      defineProject({
        test: {
          name: 'component',
          environment: 'jsdom',
          environmentOptions: {
            // Story 5: '/' is now the home page; the default component-test
            // URL opens a board so the existing App-rendering specs see the
            // board UI. Pages specs pushState to their own URLs per test.
            jsdom: {
              pretendToBeVisual: true,
              url: 'http://localhost:28432/b/' + 'a'.repeat(22),
            },
          },
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/setup/component.ts'],
        },
      }),
      defineWorkersProject({
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          pool: '@cloudflare/vitest-pool-workers',
          testTimeout: 30000,
          // Build dist/client when missing (the SPA fallback tests need it).
          globalSetup: './scripts/ensure-dist.mjs',
          poolOptions: {
            workers: {
              wrangler: { configPath: 'wrangler.jsonc' },
              main: 'src/worker/index.ts',
              isolatedStorage: false,
            },
          },
        },
      }),
    ],
  },
});
