/**
 * Board creation (story 5, `share.board_api`).
 *
 * One board is one id and one Durable Object, and creating it is exactly those
 * two things: generate a fresh 128-bit id with the story-3 generator, then make
 * the board's own object stamp it into existence over a single RPC. There is no
 * retry loop. A collision between two 128-bit random ids is not a practical
 * event; if `initialize()` ever reported an id as already existing, the honest
 * answer is a creation failure, not another guess.
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new, empty board and return its id, or report `create_failed`.
 *
 * A throw from the RPC (storage unavailable) or an `initialize()` that says the
 * id already exists both mean the same thing to the caller: nothing was created,
 * try again later.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await room.initialize();
    if (outcome === 'created') return { ok: true, id };
    return { ok: false, reason: 'create_failed' };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'board-create-failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}
