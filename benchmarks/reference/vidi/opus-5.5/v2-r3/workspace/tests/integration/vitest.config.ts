// Integration tests run the real Worker, BoardRoom Durable Object and WebSockets
// in workerd. They use their own vitest 4 toolchain (this directory's
// package.json) because @cloudflare/vitest-pool-workers does not support the
// app's vitest 5.
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // Root stays here so `vitest` resolves to this directory's vitest 4.
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { fs: { allow: [root] } },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: `${root}/wrangler.jsonc` },
      // The pool's bundled workerd lags wrangler's newest compatibility date.
      miniflare: { compatibilityDate: '2026-08-22' },
    }),
  ],
  test: {
    name: 'integration',
    include: ['**/*.test.ts'],
    testTimeout: 30_000,
  },
});
