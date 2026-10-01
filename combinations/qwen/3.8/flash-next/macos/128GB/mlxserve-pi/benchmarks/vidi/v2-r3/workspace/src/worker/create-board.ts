// Creating a board (share.create, share.board_api).
//
// One board is created by one id generation and one RPC: a fresh, unguessable
// id (128 random bits — never derived from time, a counter or another board) is
// handed to that board's own `BoardRoom`, which makes its tables and stamps
// `created_at`. There is no retry loop: with 128-bit ids a collision is not a
// practical event, so if `initialize()` ever answered `exists` for a brand-new
// id, or the RPC threw, creation simply fails with `create_failed` (a 500),
// exactly as the design states (share.unguessable, share.create_failure).
import { newBoardId } from '../shared/board-id';
import type { BoardRoom } from './board-room';
import type { Env } from './index';

/** The outcome of trying to create one board. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new empty board and return its id, or report `create_failed` if the
 * Durable Object could not be reached or the fresh id somehow already existed.
 *
 * `initialize()` is a Durable Object RPC: the stub answers it as a promise even
 * though the class method is declared synchronous, so the stub is narrowed to
 * the class type here exactly as the platform dispatches it.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await (stub as unknown as BoardRoom).initialize();
    if (result === 'created') return { ok: true, id };
    // `exists` for a freshly generated id: not a practical event (128-bit ids),
    // and the honest response is a failure, not silently reusing someone's board.
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
