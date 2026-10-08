/**
 * Server-side board creation (story 5, share.board_api).
 *
 * One `newBoardId()` (128 bits from crypto.getRandomValues, story 3) plus
 * one Durable Object RPC (`initialize()`), which migrates the board's tables
 * and records `created_at` exactly once. There is deliberately NO retry loop:
 * a collision between two freshly generated 128-bit ids is not a practical
 * event (share.unguessable), and if it ever happens creation fails with
 * create_failed rather than silently handing out somebody else's board.
 */

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const outcome = await stub.initialize();
    if (outcome === 'created') {
      return { ok: true, id };
    }
    console.error('createBoard: initialize reported an existing board for a fresh id');
    return { ok: false, reason: 'create_failed' };
  } catch (error) {
    console.error('createBoard: initialize RPC failed: ' + String(error));
    return { ok: false, reason: 'create_failed' };
  }
}
