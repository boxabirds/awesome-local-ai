/**
 * Creating a board (anchor `share.board_api`, requirement `share.create`).
 *
 * One id, one RPC, one small SQLite write - which is why clicking **New board**
 * lands on the board well inside `CREATE_BUDGET_MS` (`share.create`, 2 seconds
 * click to board):
 *
 * ```text
 * newBoardId()            16 random bytes (`share.unguessable`)
 * stub.initialize()       create the board's tables and its `created_at`
 * ```
 *
 * There is no retry loop. A 128-bit random id colliding with a board that
 * already exists is not a practical event; if `initialize()` ever answers
 * `exists` for a freshly generated id, creation fails with 500 rather than
 * quietly reusing somebody else's board.
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Create one new empty board and return its address. */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const namespace = env.BOARD_ROOM;
  try {
    const outcome = await namespace.get(namespace.idFromName(id)).initialize();
    if (outcome !== 'created') {
      // An id that is already somebody's board: refuse rather than share it.
      console.error(JSON.stringify({ event: 'board-create-collision', board: id }));
      return { ok: false, reason: 'create_failed' };
    }
    console.log(JSON.stringify({ event: 'board-created', board: id }));
    return { ok: true, id };
  } catch (error) {
    console.error(JSON.stringify({ event: 'board-create-failed', board: id, error: describe(error) }));
    return { ok: false, reason: 'create_failed' };
  }
}
