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
          include: ['tests/component/**/*.test.tsx', 'tests/component/**/*.test.ts'],
          globals: true,
        },
      },
      {
        test: {
          name: 'integration',
          // Workers pool provides its own runtime environment; don't set environment.
          include: ['tests/integration/**/*.test.ts'],
          // Use the @cloudflare/vitest-pool-workers plugin
          pool: '@cloudflare/vitest-pool-workers',
          poolOptions: {
            workers: {
              wrangler: { config: './wrangler.jsonc' },
              miniflare: {
                compatibilityFlags: ['nodejs_compat', 'export_commonjs_default'],
              },
            },
          },
        },
      },
    ],
  },
});
