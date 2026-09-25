/**
 * Bindings of the board Worker.
 *
 * Kept in its own file so `board-room.ts` can type itself against the same
 * environment without importing `index.ts` back.
 */
import type { BoardRoom } from './board-room';

export interface Env {
  /** One instance per board id; the id is the object's name. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not a room. */
  ASSETS: Fetcher;
}
