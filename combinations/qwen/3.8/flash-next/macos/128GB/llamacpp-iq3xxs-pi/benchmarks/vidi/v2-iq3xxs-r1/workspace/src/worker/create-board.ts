import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

/**
 * Creating a board (story 5, `share.board_api`).
 *
 * A board is created deliberately, by one HTTP call, and never as a side effect of
 * someone opening an address — which is what lets an unknown link answer "Board not
 * found" instead of quietly starting a second copy of the work (PRD share.not_found).
 */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Make one new board and return its address.
 *
 * One 128-bit id (`newBoardId`), one `initialize()` RPC, one small SQLite write —
 * that is the whole cost, which is why the POST fits inside `CREATE_BUDGET_MS`.
 * There is deliberately **no retry loop**: a collision between two 128-bit random
 * ids is not a practical event, so if `initialize()` ever reported `exists` for a
 * freshly generated id the honest answer is `create_failed`, not a second attempt.
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
    const outcome = await room.initialize();
    if (outcome !== 'created') {
      // Practically impossible; never overwrite a board that already exists.
      console.error(
        JSON.stringify({ level: 'error', event: 'board_create_failed', board: id, reason: 'exists' }),
      );
      return { ok: false, reason: 'create_failed' };
    }
    console.info(JSON.stringify({ level: 'info', event: 'board_created', board: id }));
    return { ok: true, id };
  } catch (error) {
    // The RPC itself failed (the object could not be reached, storage rejected the
    // write): say so honestly rather than handing back a board nobody can open.
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'board_create_failed',
        board: id,
        reason: 'rpc_threw',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 100),
      }),
    );
    return { ok: false, reason: 'create_failed' };
  }
}
