import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const shared = {
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^lucide-react\/icons\/(.+)$/, replacement: 'lucide-react/dist/esm/icons/$1.mjs' },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
};

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    projects: [
      {
        ...shared,
        test: {
          name: 'web-unit',
          root: fileURLToPath(new URL('.', import.meta.url)),
          environment: 'happy-dom',
          include: ['test/unit/**/*.test.{ts,tsx}', 'test/lib/**/*.test.ts', 'test/features/**/*.test.ts'],
          exclude: ['test/features/workspace/workspaceLoader.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        ...shared,
        test: {
          name: 'ui',
          root: fileURLToPath(new URL('.', import.meta.url)),
          environment: 'happy-dom',
          include: [
            'src/**/*.test.{ts,tsx}',
            'test/ui/**/*.test.{ts,tsx}',
            'test/features/**/*.test.tsx',
            'test/features/workspace/workspaceLoader.test.ts',
          ],
          setupFiles: ['test/setup.ts'],
        },
      },
    ],
  },
});
