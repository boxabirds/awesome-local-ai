import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
          include: ['tests/component/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/component/setup.ts'],
        },
      },
      // The `integration` project runs the real Worker + Durable Object + WebSockets
      // inside workerd and therefore lives in its own config built with the Workers
      // pool's own config helper (`vitest.worker.config.ts`). Referenced by path and
      // selected with `vitest run --project integration`.
      './vitest.worker.config.ts',
    ],
  },
});
