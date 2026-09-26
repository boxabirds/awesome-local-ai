import type { BoardRoom } from './board-room';

/** Bindings declared in `wrangler.jsonc`. */
export interface Env {
  /** One BoardRoom instance per board id. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every non-API path. */
  ASSETS: Fetcher;
}
