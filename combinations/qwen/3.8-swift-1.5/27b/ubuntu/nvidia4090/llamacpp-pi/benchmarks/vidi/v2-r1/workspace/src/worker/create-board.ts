import { newBoardId } from '../shared/board-id';
import type { Env } from './index';

export type CreateResult = { ok: true; id: string } | { ok: false; reason: 'create_failed' };

/**
 * Create a new board: one 128-bit random id plus one `initialize()` RPC.
 *
 * There is no retry loop: a collision between 128-bit random ids is not a
 * practical event (share.unguessable). If `initialize()` ever returns
 * `exists` for a fresh id, or the RPC throws, creation fails with
 * `create_failed` (the worker maps that to 500).
 */
export async function createBoard(env: Env): Promise<CreateResult> {
  const id = newBoardId();
  const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
  try {
    const result = await stub.initialize();
    if (result === 'created') {
      return { ok: true, id };
    }
    return { ok: false, reason: 'create_failed' };
  } catch {
    return { ok: false, reason: 'create_failed' };
  }
}
