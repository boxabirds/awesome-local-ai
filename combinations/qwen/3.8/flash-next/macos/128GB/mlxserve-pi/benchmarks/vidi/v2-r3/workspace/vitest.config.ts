import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vitest projects, one per tier:
//
//   unit         — Yjs document model and the pure helpers, Node runtime.
//   component    — React components, jsdom, no network (App renders a local
//                  board when the URL carries no board address).
//   integration  — the real Worker and the real BoardRoom Durable Object on
//                  workerd, driven over HTTP and over real WebSockets through
//                  `SELF.fetch`. This is the tier story 3 adds.
//
// `npm run test` runs all three; e2e lives in Playwright (`npm run test:e2e`).

const unit = {
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
};

const component = {
  test: {
    name: 'component',
    environment: 'jsdom',
    include: ['tests/component/**/*.test.tsx'],
    setupFiles: ['tests/component/setup.ts'],
  },
};

// The integration tier runs on another pool (the Workers runtime), so it is a
// separate config file: Vitest only resolves `pool: 'workers'` for a standalone
// config, not for an inline project next to DOM/Node ones.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [unit, component, './vitest.integration.config.ts'],
  },
});
