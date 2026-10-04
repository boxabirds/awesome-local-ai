import { defineWorkspace } from 'vitest/config';

// Two projects per the design's "vitest.config.ts projects" intent.
// Vitest 2.x expresses projects via a workspace file; `--project unit|component` selects them.
export default defineWorkspace([
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
      globals: true,
      include: ['tests/component/**/*.test.tsx'],
      setupFiles: ['tests/component/setup.ts'],
    },
  },
]);
