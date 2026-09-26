import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

const shared = { root: import.meta.dirname, environment: 'happy-dom' as const, setupFiles: ['./test/setup.ts'] };

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        { extends: true, test: { ...shared, name: 'web-unit', include: ['test/unit/**/*.test.{ts,tsx}'] } },
        {
          extends: true,
          test: { ...shared, name: 'web-ui', include: ['src/**/*.test.{ts,tsx}', 'test/ui/**/*.test.{ts,tsx}'] },
        },
      ],
    },
  }),
);
