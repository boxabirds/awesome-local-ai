import { defineConfig } from 'vitest/config';

// Two projects:
//  - unit:      pure maths, run in node (no DOM)
//  - component: React components, run in jsdom with Testing Library
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
    ],
  },
});
