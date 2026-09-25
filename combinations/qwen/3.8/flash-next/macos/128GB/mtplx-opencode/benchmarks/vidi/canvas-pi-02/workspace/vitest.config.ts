import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Two Vitest projects (design "Test scopes and boundaries"):
//  - unit: pure camera maths, node environment
//  - component: BoardViewport / ZoomControls / NavigationHint in jsdom
// E2E lives in Playwright (playwright.config.ts), not here.
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
          globals: true,
          setupFiles: ['tests/component/setup.ts'],
          include: ['tests/component/**/*.test.tsx'],
        },
      },
    ],
  },
});
