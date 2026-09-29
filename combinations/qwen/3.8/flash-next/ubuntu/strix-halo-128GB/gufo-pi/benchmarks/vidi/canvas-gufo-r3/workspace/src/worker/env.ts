// Shared Worker binding shape. Both the entry (`index.ts`) and the room
// (`board-room.ts`) import this type-only module, avoiding a runtime cycle while
// keeping `env.BOARD_ROOM` typed to the `BoardRoom` class.
import type { BoardRoom } from './board-room';

export interface Env {
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  ASSETS: Fetcher;
  ASSETS_BUCKET: R2Bucket;
  BOARD_CREATE_LIMITER?: RateLimit;
  ASSET_UPLOAD_LIMITER?: RateLimit;
  TEST_HOOKS?: string;
}
