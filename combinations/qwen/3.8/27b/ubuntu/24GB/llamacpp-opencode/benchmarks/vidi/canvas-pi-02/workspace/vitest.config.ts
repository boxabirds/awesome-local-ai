import { defineConfig } from 'vitest/config';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

// Three projects:
//  - unit:        pure maths and protocol helpers, run in node (no DOM)
//  - component:   React components, run in jsdom with Testing Library
//  - integration: real Worker + Durable Objects in workerd (miniflare),
//                 exercised through the Worker entry via SELF.fetch
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
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/setup/component-setup.ts'],
        },
      },
      defineWorkersProject({
        test: {
          name: 'integration',
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              wrangler: { configPath: './wrangler-test.jsonc' },
              // Per-test storage isolation cannot be popped while a Durable
              // Object still holds an open WebSocket; the tests use unique
              // board ids, so they do not rely on it.
              isolatedStorage: false,
            },
          },
          include: ['tests/integration/**/*.test.ts'],
        },
      }),
    ],
  },
});
