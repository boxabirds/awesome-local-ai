/**
 * Creating a board (share.board_api). The id is generated here, server-side, and
 * the board is created by talking to its Durable Object over Durable Object RPC:
 * the room's `initialize()` makes its tables and marks it created, so the board
 * can be opened even while it holds no notes.
 *
 * This is the only way a brand-new board comes into existence. Opening a link —
 * a WebSocket connection to a room — no longer creates one; that is what makes a
 * mistyped link a "Board not found" page rather than a silent new board
 * (share.not_found).
 *
 * Spec: spec/stories/005-share-a-board-with-others-using-a-link/design.md,
 * "Board creation and existence API" (share.board_api), TC-03 to TC-06.
 */
import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

/** A board id, or the one failure a create can return: it could not be made. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  // A fresh 128-bit link code (share.unguessable); nobody ever types one, so it
  // is generated here and nowhere else.
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    // Durable Object RPC. A board id is generated fresh, so 'created' is the
    // only answer that can come back; anything else (or a throw) means the board
    // is not there to be opened, and the caller answers 500 (share.create_failed).
    if ((await stub.initialize()) === 'created') return { ok: true, id };
    return { ok: false, reason: 'create_failed' };
  } catch (error) {
    console.error('[vidi6] board creation failed', { reason: 'create_failed', error: String(error) });
    return { ok: false, reason: 'create_failed' };
  }
}
