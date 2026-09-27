import type { BoardRoom } from './board-room';
import type { Limiter } from './create-board';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  /** One BoardRoom instance per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every non-API path. */
  ASSETS: Fetcher;
  /** Rate limiter for board creation (story 5). Optional: when absent (local test runtime), creation is unlimited. */
  BOARD_CREATE_LIMITER?: Limiter;
  /**
   * Uploaded images, keyed `<boardId>/<assetId>` (story 12). Keys are unguessable
   * and knowing one is the only way to read it, so the bucket is reached by key
   * alone: nothing lists it and nothing reads a prefix of it.
   */
  ASSETS_BUCKET: R2Bucket;
  /**
   * Per-visitor cap on image uploads (PRD `image.rate_limit`). Optional: when
   * absent (local test runtime) uploads are unlimited rather than impossible.
   */
  ASSET_UPLOAD_LIMITER?: Limiter;
}
