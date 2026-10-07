// Board creation (story 5, share.board_api): one 128-bit random id plus one
// Durable Object RPC that initialises the board's storage.
//
// There is deliberately no retry loop: a collision between two 128-bit random
// ids is not a practical event (share.unguessable). If initialize() ever
// returns 'exists' for a freshly generated id, or the RPC throws, creation
// fails with 500 create_failed and the home page explains it.

import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await stub.initialize();
    if (result === 'exists') return { ok: false, reason: 'create_failed' };
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
