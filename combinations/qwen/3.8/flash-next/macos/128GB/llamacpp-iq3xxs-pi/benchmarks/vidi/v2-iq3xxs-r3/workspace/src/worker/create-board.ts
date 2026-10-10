/**
 * Making a new board (share.board_api, share.create).
 *
 * One id, one RPC, one small SQLite write — that is the whole of it, and it is
 * deliberately not a retry loop. A board's link is its only access control
 * (PRD security model), so its id comes from `newBoardId()`: 128 random bits.
 * Two boards getting the same id is not a practical event, and if it ever
 * happened the second creation fails with 500 rather than silently opening two
 * boards at one address — see the design's "Not covered" note.
 */
import { newBoardId } from '../shared/board-id';

import type { Env } from './index';

/** Either a board that is there now, or the honest reason there is not. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create one board and return its id.
 *
 * `initialize()` is the room's own RPC: it writes the tables and this board's
 * `created_at`, so the board exists (answers `GET /api/boards/:id` with 200 and
 * accepts a websocket) before the caller is told the id. A room that would not
 * answer, or that already had this id, ends the call as `create_failed`; the
 * Worker turns that into a 500 and the home page says so (share.create_failure).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  let outcome: 'created' | 'exists';
  try {
    outcome = await room.initialize();
  } catch (error) {
    console.error(
      `board could not be created (${id}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ok: false, reason: 'create_failed' };
  }
  if (outcome !== 'created') {
    // Only possible if 128 random bits repeated, or if a board was made at this
    // id by something other than this endpoint. Either way: refuse, and let the
    // person press the button again.
    console.error(`board id ${id} belongs to a board already`);
    return { ok: false, reason: 'create_failed' };
  }
  return { ok: true, id };
}

/**
 * Whether this link leads to a board (share.not_found).
 *
 * A malformed id is answered by the Worker without consulting anybody, so no
 * Durable Object is ever instantiated for `/api/boards/abc` (TC-07); a valid one
 * costs one read-only RPC. Unknown and malformed deliberately get the same 404 —
 * nothing here tells a stranger whether they nearly guessed.
 */
export async function boardExists(env: Env, id: string): Promise<boolean> {
  const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  return room.exists();
}
