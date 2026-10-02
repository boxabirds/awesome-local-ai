import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Three Vitest projects: pure maths in node, React components in jsdom, and the
// Worker + Durable Object tests inside the real Workers runtime (workerd).
// E2E tests live in tests/e2e and run under Playwright (see playwright.config.ts).
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
          include: ['tests/component/**/*.test.tsx'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      {
        // The Worker entry and the board's room, tested against the real runtime:
        // real `fetch` handling, real Durable Object, real WebSockets, real Yjs.
        // See tests/integration/.
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
          }),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
