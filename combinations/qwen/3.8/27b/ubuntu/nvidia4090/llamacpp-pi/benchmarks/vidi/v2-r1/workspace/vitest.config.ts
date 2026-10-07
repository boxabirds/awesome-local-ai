import { defineConfig, defineProject } from 'vitest/config';

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
    ],
  },
});
