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
            jsdom: { pretendToBeVisual: true, url: 'http://localhost:28432/' },
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
