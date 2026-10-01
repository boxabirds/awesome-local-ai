import { fileURLToPath } from 'node:url';
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    name: 'integration',
    // vitest 3.2 resolves a bare pool name relative to the project root; hand it the real path.
    pool: fileURLToPath(import.meta.resolve('@cloudflare/vitest-pool-workers')),
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    poolOptions: { workers: { singleWorker: true, isolatedStorage: false, wrangler: { configPath: './wrangler.jsonc' } } },
  },
});
