/**
 * Bindings of the board Worker.
 *
 * Kept in its own file so `board-room.ts` can type itself against the same
 * environment without importing `index.ts` back.
 */
import type { BoardRoom } from './board-room';
import type { Limiter } from '../shared/create-board';

export interface Env {
  /** One instance per board id; the id is the object's name. */
  BOARD_ROOM: DurableObjectNamespace<BoardRoom>;
  /** The built client, served for every path that is not a room. */
  ASSETS: Fetcher;
  /**
   * How many boards one visitor may start in a minute.
   *
   * Optional in the type because the local integration worker can be built
   * against a fake with the same shape: the limit is a product rule, and the
   * tests have to be able to say "the eleventh" without a real minute passing.
   */
  BOARD_CREATE_LIMITER?: Limiter;
}

export type { Limiter };