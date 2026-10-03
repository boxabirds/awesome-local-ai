// Board creation: generates a new 128-bit random id and initialises the
// board's Durable Object via one RPC (no retry loop; a collision is not a
// practical event with 128 random bits).

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await stub.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    // 'exists' for a freshly generated id means collision (not practical).
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
