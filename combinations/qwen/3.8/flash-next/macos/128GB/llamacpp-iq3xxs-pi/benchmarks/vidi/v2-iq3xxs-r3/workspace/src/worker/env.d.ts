/**
 * The bindings `wrangler.jsonc` gives this Worker, declared for `cloudflare:test`
 * (`import { env } from 'cloudflare:test'` is typed as `Cloudflare.Env`).
 * `src/worker/index.ts` re-exports the same shape as its own `Env` interface.
 */
import type { BoardRoom } from './board-room';

declare global {
  namespace Cloudflare {
    interface Env {
      /** One Durable Object per board id; the board's live room. */
      BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
      /** The built client, served for every other path. */
      ASSETS: Fetcher;
      /**
       * Test routes (`src/worker/test-hooks.ts`) are registered only when this is
       * exactly `1`. Set by the e2e dev server alone — absent in production
       * config, so the routes do not exist in a deployment (story 4's design).
       */
      TEST_HOOKS?: string;
    }
  }
}

export {};
