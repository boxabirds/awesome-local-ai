/**
 * The bindings `cloudflare:test` gives the integration tests, matching the
 * `BOARD_ROOM` and `ASSETS` bindings in wrangler.jsonc. This is what `env` from
 * `cloudflare:test` is typed as.
 */
import type { BoardRoom } from '../../src/worker/board-room.js';

declare global {
  namespace Cloudflare {
    interface Env {
      /** One Durable Object per board id. */
      BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
      /** The built client. */
      ASSETS: Fetcher;
    }
  }
}

export {};
