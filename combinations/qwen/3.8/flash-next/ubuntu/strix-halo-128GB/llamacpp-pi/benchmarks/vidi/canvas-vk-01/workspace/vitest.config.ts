import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Vitest projects: `unit` runs in node (pure maths), `component` runs in jsdom,
// `integration` runs inside workerd against the real Worker + BoardRoom (the
// react plugin must not apply there, so it is attached per project instead of
// at the root).
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['tests/component/**/*.{test,spec}.{ts,tsx}'],
          setupFiles: ['./tests/component/setup.ts'],
        },
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
