/**
 * The bindings `cloudflare:test` gives the integration tests, matching the bindings in
 * wrangler.jsonc. This is what `env` from `cloudflare:test` is typed as. The bucket is
 * created in Miniflare from the same `r2_buckets` entry, so an integration test writes
 * and reads the storage the Worker writes and reads.
 */
import type { BoardRoom } from '../../src/worker/board-room.js';

declare global {
  namespace Cloudflare {
    interface Env {
      /** One Durable Object per board id. */
      BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
      /** The built client. */
      ASSETS: Fetcher;
      /** The board's images, by `{boardId}/{assetId}`. */
      ASSETS_BUCKET: R2Bucket;
    }
  }
}

export {};
