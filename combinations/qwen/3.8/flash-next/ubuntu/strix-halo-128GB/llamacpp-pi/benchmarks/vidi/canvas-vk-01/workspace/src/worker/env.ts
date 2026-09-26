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
}
