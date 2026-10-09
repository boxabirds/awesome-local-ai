// Integration tests run in workerd through @cloudflare/vitest-pool-workers:
// real Worker fetch, real Durable Object, real WebSockets (SELF.fetch with
// an Upgrade header returns a live socket pair).
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        // BoardRoom keeps its Y.Doc in memory only (story 4 introduces DO
        // storage), so per-test storage isolation has nothing to undo and
        // only breaks when long-lived WebSocket handles outlive a test.
        isolatedStorage: false,
      },
    },
  },
});
