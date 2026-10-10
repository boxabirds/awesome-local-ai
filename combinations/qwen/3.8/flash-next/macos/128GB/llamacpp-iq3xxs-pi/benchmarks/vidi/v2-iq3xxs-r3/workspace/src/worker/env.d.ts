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
    }
  }
}

export {};
